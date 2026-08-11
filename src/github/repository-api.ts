import type { UpdateArtifactFile } from '../types.js';
import type { ExistingPullRequest } from './reconcile.js';
import type { GitHubHttpMethod, GitHubRequester } from './api-client.js';
import {
    boundedText,
    canonicalCommitFiles,
    decodeNestedSha,
    decodeObjectSha,
    decodeOpenPullRequests,
    decodePullRequestNumber,
    fullSha,
    generatedBranch,
    generatedBranchPath,
    githubRepositoryError,
    positiveNumber,
    repositoryName,
    requireStatus,
    safeBranchName,
} from './repository-values.js';

const MAX_OPEN_PULL_REQUESTS = 1000;
const PAGE_SIZE = 100;

export interface GitHubRepositoryApiOptions {
    readonly owner: string;
    readonly repository: string;
    readonly requester: GitHubRequester;
}

export interface ManagedCommitInput {
    readonly baseSha: string;
    readonly files: readonly UpdateArtifactFile[];
    readonly message: string;
    readonly previousManagedHead?: string;
}

export interface PullRequestWrite {
    readonly baseBranch: string;
    readonly body: string;
    readonly branch: string;
    readonly title: string;
}

export class GitHubRepositoryApi {
    readonly #prefix: string;
    readonly #requester: GitHubRequester;

    constructor(options: GitHubRepositoryApiOptions) {
        const owner = repositoryName(options.owner, 'owner');
        const repository = repositoryName(options.repository, 'repository');
        this.#prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
        this.#requester = options.requester;
    }

    async getDefaultBranchHead(branch: string): Promise<string | null> {
        const validated = safeBranchName(branch, 'default branch');
        const path = validated.split('/').map(encodeURIComponent).join('/');
        const response = await this.#requester({
            method: 'GET',
            path: `${this.#prefix}/git/ref/heads/${path}`,
        });
        if (response.status === 404) return null;
        requireStatus(response.status, [200], 'read the default branch reference');
        return decodeNestedSha(response.value, ['object', 'sha'], 'default branch reference');
    }

    async getGeneratedBranchHead(branch: string): Promise<string | null> {
        const path = `${this.#prefix}/git/ref/heads/${generatedBranchPath(branch)}`;
        const response = await this.#requester({ method: 'GET', path });
        if (response.status === 404) return null;
        requireStatus(response.status, [200], 'read a managed branch reference');
        return decodeNestedSha(response.value, ['object', 'sha'], 'managed branch reference');
    }

    async createManagedCommit(input: ManagedCommitInput): Promise<string> {
        const baseSha = fullSha(input.baseSha, 'base commit');
        const previous = input.previousManagedHead === undefined
            ? undefined
            : fullSha(input.previousManagedHead, 'previous managed head');
        const files = canonicalCommitFiles(input.files);
        const treeSha = await this.commitTree(baseSha);
        const blobs = [];
        for (const file of files) {
            blobs.push({ file, sha: await this.createBlob(file.content) });
        }
        const updatedTree = await this.createTree(treeSha, blobs);
        const parents = previous === undefined || previous === baseSha
            ? [baseSha]
            : [previous, baseSha];
        return this.createCommit(input.message, updatedTree, parents);
    }

    async createGeneratedBranch(branch: string, sha: string): Promise<void> {
        const validatedBranch = generatedBranch(branch);
        await this.request(
            'POST',
            `${this.#prefix}/git/refs`,
            { ref: `refs/heads/${validatedBranch}`, sha: fullSha(sha, 'branch commit') },
            [201],
            'create a managed branch',
        );
    }

    async fastForwardGeneratedBranch(branch: string, sha: string): Promise<void> {
        await this.request(
            'PATCH',
            `${this.#prefix}/git/refs/heads/${generatedBranchPath(branch)}`,
            { force: false, sha: fullSha(sha, 'branch commit') },
            [200],
            'fast-forward a managed branch',
        );
    }

    async listOpenPullRequests(): Promise<readonly ExistingPullRequest[]> {
        const pullRequests: ExistingPullRequest[] = [];
        for (let page = 1; pullRequests.length < MAX_OPEN_PULL_REQUESTS; page += 1) {
            const value = await this.request(
                'GET',
                `${this.#prefix}/pulls?state=open&sort=created&direction=asc&per_page=${PAGE_SIZE.toString()}&page=${page.toString()}`,
                undefined,
                [200],
                'list open pull requests',
            );
            const batch = decodeOpenPullRequests(value, PAGE_SIZE);
            pullRequests.push(...batch);
            if (batch.length < PAGE_SIZE) return Object.freeze(pullRequests);
        }
        throw githubRepositoryError('The repository has too many open pull requests to reconcile safely.');
    }

    async createPullRequest(input: PullRequestWrite): Promise<number> {
        generatedBranch(input.branch);
        const value = await this.request(
            'POST',
            `${this.#prefix}/pulls`,
            {
                base: safeBranchName(input.baseBranch, 'base branch'),
                body: boundedText(input.body, 'pull request body', 65_536),
                draft: false,
                head: input.branch,
                maintainer_can_modify: false,
                title: boundedText(input.title, 'pull request title', 256),
            },
            [201],
            'create a managed pull request',
        );
        return decodePullRequestNumber(value);
    }

    async updatePullRequest(number: number, input: PullRequestWrite): Promise<void> {
        generatedBranch(input.branch);
        await this.request(
            'PATCH',
            `${this.#prefix}/pulls/${positiveNumber(number, 'pull request number').toString()}`,
            {
                base: safeBranchName(input.baseBranch, 'base branch'),
                body: boundedText(input.body, 'pull request body', 65_536),
                title: boundedText(input.title, 'pull request title', 256),
            },
            [200],
            'update a managed pull request',
        );
    }

    async closePullRequest(number: number): Promise<void> {
        await this.request(
            'PATCH',
            `${this.#prefix}/pulls/${positiveNumber(number, 'pull request number').toString()}`,
            { state: 'closed' },
            [200],
            'close a managed pull request',
        );
    }

    private async request(
        method: GitHubHttpMethod,
        path: string,
        body: unknown,
        statuses: readonly number[],
        operation: string,
    ): Promise<unknown> {
        const request = body === undefined ? { method, path } : { body, method, path };
        const response = await this.#requester(request);
        requireStatus(response.status, statuses, operation);
        return response.value;
    }

    private async commitTree(commitSha: string): Promise<string> {
        const value = await this.request(
            'GET',
            `${this.#prefix}/git/commits/${commitSha}`,
            undefined,
            [200],
            'read the base commit tree',
        );
        return decodeNestedSha(value, ['tree', 'sha'], 'base commit tree');
    }

    private async createBlob(content: Buffer): Promise<string> {
        const value = await this.request(
            'POST',
            `${this.#prefix}/git/blobs`,
            { content: content.toString('base64'), encoding: 'base64' },
            [201],
            'create an update blob',
        );
        return decodeObjectSha(value, 'created blob');
    }

    private async createTree(
        baseTree: string,
        entries: readonly { readonly file: UpdateArtifactFile; readonly sha: string }[],
    ): Promise<string> {
        const value = await this.request(
            'POST',
            `${this.#prefix}/git/trees`,
            {
                base_tree: baseTree,
                tree: entries.map(({ file, sha }) => ({
                    mode: file.mode,
                    path: file.path,
                    sha,
                    type: 'blob',
                })),
            },
            [201],
            'create an update tree',
        );
        return decodeObjectSha(value, 'created tree');
    }

    private async createCommit(
        message: string,
        tree: string,
        parents: readonly string[],
    ): Promise<string> {
        const value = await this.request(
            'POST',
            `${this.#prefix}/git/commits`,
            {
                message: boundedText(message, 'commit message', 4096),
                parents,
                tree,
            },
            [201],
            'create an update commit',
        );
        return decodeObjectSha(value, 'created commit');
    }
}

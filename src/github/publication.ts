import { actionError, UpdateDependenciesError } from '../errors.js';
import type { ExactUpdateArtifact, PlannedUpdate } from '../types.js';
import {
    prepareExactUpdateArtifact,
    type ExactUpdateExecutionInput,
} from '../update/executor.js';
import { renderManagedPullRequest, renderPullRequestPreview } from './preview.js';
import {
    reconcileManagedPullRequests,
    type ManagedPullRequestReconciliation,
    type MatchedManagedPullRequest,
    type RetainedManagedTarget,
} from './reconcile.js';
import type { GitHubRepositoryApi } from './repository-api.js';

export type ManagedPublicationRepository = Pick<GitHubRepositoryApi,
    | 'closePullRequest'
    | 'createGeneratedBranch'
    | 'createManagedCommit'
    | 'createPullRequest'
    | 'fastForwardGeneratedBranch'
    | 'getDefaultBranchHead'
    | 'getGeneratedBranchHead'
    | 'listOpenPullRequests'
    | 'updatePullRequest'>;

export interface ManagedPublicationInput
    extends Omit<ExactUpdateExecutionInput, 'target'> {
    readonly baseSha: string;
    readonly defaultBranch: string;
    readonly openPullRequestsLimit: number;
    readonly repositoryId: string;
    readonly retained?: readonly RetainedManagedTarget[];
    readonly targets: readonly PlannedUpdate[];
}

export interface ManagedPublicationDependencies {
    readonly prepareArtifact?: typeof prepareExactUpdateArtifact;
    readonly repositoryApi: ManagedPublicationRepository;
}

export type ManagedPublicationWrite =
    | {
        readonly branch: string;
        readonly kind: 'branch-created' | 'branch-updated';
        readonly sha: string;
    }
    | {
        readonly branch: string;
        readonly kind: 'pull-request-created' | 'pull-request-updated';
        readonly number: number;
    }
    | {
        readonly branch: string;
        readonly kind: 'pull-request-closed';
        readonly number: number;
    };

export interface ManagedPublicationResult {
    readonly reconciliation: ManagedPullRequestReconciliation;
    readonly visibleWrites: readonly ManagedPublicationWrite[];
}

export class ManagedPublicationFailure extends UpdateDependenciesError {
    readonly visibleWrites: readonly ManagedPublicationWrite[];

    constructor(cause: unknown, visibleWrites: readonly ManagedPublicationWrite[]) {
        const snapshot = Object.freeze([...visibleWrites]);
        super(
            'ZOLT-PUBLISH-002',
            `Managed publication failed after ${describeWrites(snapshot)}: ${failureReason(cause)}`,
            { cause },
        );
        this.name = 'ManagedPublicationFailure';
        this.visibleWrites = snapshot;
    }
}

export async function publishManagedPullRequests(
    input: ManagedPublicationInput,
    dependencies: ManagedPublicationDependencies,
): Promise<ManagedPublicationResult> {
    const api = dependencies.repositoryApi;
    const desired = input.targets.map((target) => ({
        preview: renderPullRequestPreview(target),
        target,
    }));
    const existing = await api.listOpenPullRequests();
    const reconciliation = reconcileManagedPullRequests({
        baseSha: input.baseSha,
        defaultBranch: input.defaultBranch,
        desired,
        existing,
        openPullRequestsLimit: input.openPullRequestsLimit,
        repositoryId: input.repositoryId,
        ...(input.retained === undefined ? {} : { retained: input.retained }),
    });
    if (!hasWrites(reconciliation)) {
        return Object.freeze({ reconciliation, visibleWrites: Object.freeze([]) });
    }

    const prepare = dependencies.prepareArtifact ?? prepareExactUpdateArtifact;
    await preflight(input, reconciliation, api);
    const artifacts = await prepareArtifacts(input, reconciliation, prepare);
    const visibleWrites: ManagedPublicationWrite[] = [];
    try {
        for (const pullRequest of reconciliation.close) {
            await requireWriteBoundary(input, api, pullRequest.branch, pullRequest.headSha);
            await api.closePullRequest(pullRequest.number);
            visibleWrites.push(Object.freeze({
                branch: pullRequest.branch,
                kind: 'pull-request-closed',
                number: pullRequest.number,
            }));
        }
        for (const matched of reconciliation.refresh) {
            await refreshPullRequest(input, matched, requireArtifact(artifacts, matched.desired.target), api, visibleWrites);
        }
        for (const entry of reconciliation.create) {
            await createPullRequest(input, entry.target, requireArtifact(artifacts, entry.target), api, visibleWrites);
        }
    } catch (error) {
        if (visibleWrites.length === 0) throw error;
        throw new ManagedPublicationFailure(error, visibleWrites);
    }
    return Object.freeze({
        reconciliation,
        visibleWrites: Object.freeze([...visibleWrites]),
    });
}

async function preflight(
    input: ManagedPublicationInput,
    reconciliation: ManagedPullRequestReconciliation,
    api: ManagedPublicationRepository,
): Promise<void> {
    await requireDefaultBranch(input, api);
    for (const pullRequest of reconciliation.close) {
        await requireManagedHead(api, pullRequest.branch, pullRequest.headSha);
    }
    for (const matched of reconciliation.refresh) {
        await requireManagedHead(api, matched.existing.branch, matched.existing.headSha);
    }
    for (const entry of reconciliation.create) {
        await requireManagedHead(api, entry.preview.branch, null);
    }
}

async function prepareArtifacts(
    input: ManagedPublicationInput,
    reconciliation: ManagedPullRequestReconciliation,
    prepare: typeof prepareExactUpdateArtifact,
): Promise<ReadonlyMap<string, ExactUpdateArtifact>> {
    const artifacts = new Map<string, ExactUpdateArtifact>();
    const targets = [
        ...reconciliation.refresh.map(({ desired }) => desired.target),
        ...reconciliation.create.map(({ target }) => target),
    ];
    for (const target of targets) {
        const artifact = await prepare({
            binary: input.binary,
            environment: input.environment,
            includePrereleases: input.includePrereleases,
            repository: input.repository,
            selection: input.selection,
            target,
        });
        if (artifact.target.managedId !== target.managedId) {
            throw publicationError('The prepared artifact does not match its managed target.');
        }
        artifacts.set(target.managedId, artifact);
    }
    return artifacts;
}

async function refreshPullRequest(
    input: ManagedPublicationInput,
    matched: MatchedManagedPullRequest,
    artifact: ExactUpdateArtifact,
    api: ManagedPublicationRepository,
    visibleWrites: ManagedPublicationWrite[],
): Promise<void> {
    const { existing, desired } = matched;
    await requireWriteBoundary(input, api, existing.branch, existing.headSha);
    const commit = await api.createManagedCommit({
        baseSha: input.baseSha,
        files: artifact.files,
        message: desired.preview.title,
        previousManagedHead: existing.headSha,
    });
    await requireWriteBoundary(input, api, existing.branch, existing.headSha);
    await api.fastForwardGeneratedBranch(existing.branch, commit);
    visibleWrites.push(Object.freeze({ branch: existing.branch, kind: 'branch-updated', sha: commit }));
    await requireWriteBoundary(input, api, existing.branch, commit);
    const rendered = renderManagedPullRequest(desired.target, input.baseSha, commit);
    await api.updatePullRequest(existing.number, {
        baseBranch: input.defaultBranch,
        body: rendered.body,
        branch: rendered.branch,
        title: rendered.title,
    });
    visibleWrites.push(Object.freeze({
        branch: existing.branch,
        kind: 'pull-request-updated',
        number: existing.number,
    }));
}

async function createPullRequest(
    input: ManagedPublicationInput,
    target: PlannedUpdate,
    artifact: ExactUpdateArtifact,
    api: ManagedPublicationRepository,
    visibleWrites: ManagedPublicationWrite[],
): Promise<void> {
    const preview = renderPullRequestPreview(target);
    await requireWriteBoundary(input, api, preview.branch, null);
    const commit = await api.createManagedCommit({
        baseSha: input.baseSha,
        files: artifact.files,
        message: preview.title,
    });
    await requireWriteBoundary(input, api, preview.branch, null);
    await api.createGeneratedBranch(preview.branch, commit);
    visibleWrites.push(Object.freeze({ branch: preview.branch, kind: 'branch-created', sha: commit }));
    await requireWriteBoundary(input, api, preview.branch, commit);
    const rendered = renderManagedPullRequest(target, input.baseSha, commit);
    const number = await api.createPullRequest({
        baseBranch: input.defaultBranch,
        body: rendered.body,
        branch: rendered.branch,
        title: rendered.title,
    });
    visibleWrites.push(Object.freeze({
        branch: preview.branch,
        kind: 'pull-request-created',
        number,
    }));
}

async function requireWriteBoundary(
    input: ManagedPublicationInput,
    api: ManagedPublicationRepository,
    branch: string,
    expectedHead: string | null,
): Promise<void> {
    await requireDefaultBranch(input, api);
    await requireManagedHead(api, branch, expectedHead);
}

async function requireDefaultBranch(
    input: ManagedPublicationInput,
    api: ManagedPublicationRepository,
): Promise<void> {
    const current = await api.getDefaultBranchHead(input.defaultBranch);
    if (current !== input.baseSha) {
        throw publicationError('The default branch advanced after planning; publication was aborted.');
    }
}

async function requireManagedHead(
    api: ManagedPublicationRepository,
    branch: string,
    expected: string | null,
): Promise<void> {
    const current = await api.getGeneratedBranchHead(branch);
    if (current !== expected) {
        throw publicationError(
            expected === null
                ? `Managed branch ${branch} already exists without an owned pull request.`
                : `Managed branch ${branch} changed after reconciliation.`,
        );
    }
}

function requireArtifact(
    artifacts: ReadonlyMap<string, ExactUpdateArtifact>,
    target: PlannedUpdate,
): ExactUpdateArtifact {
    const artifact = artifacts.get(target.managedId);
    if (artifact === undefined) throw publicationError('A prepared update artifact is missing.');
    return artifact;
}

function hasWrites(reconciliation: ManagedPullRequestReconciliation): boolean {
    return reconciliation.close.length !== 0
        || reconciliation.create.length !== 0
        || reconciliation.refresh.length !== 0;
}

function describeWrites(writes: readonly ManagedPublicationWrite[]): string {
    if (writes.length === 0) return 'no visible writes';
    return `visible writes ${writes.map((write) => {
        if ('sha' in write) {
            return `${write.kind}:${write.branch}@${write.sha}`;
        }
        return `${write.kind}:#${write.number.toString()}@${write.branch}`;
    }).join(', ')}`;
}

function failureReason(error: unknown): string {
    if (error instanceof UpdateDependenciesError) return `${error.code}: ${error.message}`;
    if (error instanceof Error) return error.message;
    return String(error);
}

function publicationError(message: string): ReturnType<typeof actionError> {
    return actionError('ZOLT-PUBLISH-001', message);
}

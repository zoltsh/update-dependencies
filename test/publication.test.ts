import * as assert from 'node:assert/strict';
import test from 'node:test';

import { parseManagedMarker } from '../src/github/managed-marker.js';
import {
    ManagedPublicationFailure,
    publishManagedPullRequests,
    type ManagedPublicationInput,
    type ManagedPublicationRepository,
} from '../src/github/publication.js';
import { renderManagedPullRequest, renderPullRequestPreview } from '../src/github/preview.js';
import type { ExistingPullRequest } from '../src/github/reconcile.js';
import type { ManagedCommitInput, PullRequestWrite } from '../src/github/repository-api.js';
import { planUpdates } from '../src/planner/plan.js';
import type { ExactUpdateArtifact, PlannedUpdate } from '../src/types.js';
import type { ExactUpdateExecutionInput } from '../src/update/executor.js';
import {
    actionInputs,
    outdatedEntryV2,
    outdatedReportV2,
    outdatedScopeV2,
    projectSelection,
    repositoryView,
    targetIdFor,
} from './support/fixtures.js';

const BASE_SHA = 'a'.repeat(40);
const OLD_BASE_SHA = 'b'.repeat(40);
const OLD_HEAD_SHA = 'c'.repeat(40);
const NEW_HEAD_SHA = 'd'.repeat(40);
const HUMAN_HEAD_SHA = 'e'.repeat(40);
const ADVANCED_BASE_SHA = 'f'.repeat(40);

test('publication creates a branch and pull request from one verified exact artifact', async () => {
    const target = plannedTarget();
    const api = new FakePublicationRepository([]);
    const prepared: string[] = [];

    const result = await publishManagedPullRequests(publicationInput([target]), {
        prepareArtifact: artifactPreparer(prepared),
        repositoryApi: api,
    });

    assert.deepEqual(prepared, [target.managedId]);
    assert.deepEqual(result.visibleWrites, [
        { branch: renderPullRequestPreview(target).branch, kind: 'branch-created', sha: NEW_HEAD_SHA },
        { branch: renderPullRequestPreview(target).branch, kind: 'pull-request-created', number: 101 },
    ]);
    assert.equal(api.commitInputs[0]?.previousManagedHead, undefined);
    const pullRequest = api.createdPullRequests[0];
    assert.ok(pullRequest);
    assert.match(pullRequest.body, /locked offline verification completed/u);
    const parsed = parseManagedMarker(pullRequest.body);
    assert.equal(parsed.kind, 'valid');
    if (parsed.kind === 'valid') {
        assert.equal(parsed.marker.baseSha, BASE_SHA);
        assert.equal(parsed.marker.managedHeadSha, NEW_HEAD_SHA);
        assert.equal(parsed.marker.managedId, target.managedId);
    }
});

test('publication leaves an identical managed pull request unchanged without preparing an artifact', async () => {
    const target = plannedTarget();
    const existing = managedPullRequest(17, target, BASE_SHA, OLD_HEAD_SHA);
    const api = new FakePublicationRepository([existing], [[existing.branch, OLD_HEAD_SHA]]);
    const prepared: string[] = [];

    const result = await publishManagedPullRequests(publicationInput([target]), {
        prepareArtifact: artifactPreparer(prepared),
        repositoryApi: api,
    });

    assert.deepEqual(result.reconciliation.unchanged.map(({ existing: pull }) => pull.number), [17]);
    assert.deepEqual(result.visibleWrites, []);
    assert.deepEqual(prepared, []);
    assert.deepEqual(api.calls, ['list-open-pull-requests']);
});

test('publication refreshes the owned branch non-destructively and updates the same pull request', async () => {
    const target = plannedTarget();
    const existing = managedPullRequest(23, target, OLD_BASE_SHA, OLD_HEAD_SHA);
    const api = new FakePublicationRepository([existing], [[existing.branch, OLD_HEAD_SHA]]);

    const result = await publishManagedPullRequests(publicationInput([target]), {
        prepareArtifact: artifactPreparer([]),
        repositoryApi: api,
    });

    assert.deepEqual(result.visibleWrites, [
        { branch: existing.branch, kind: 'branch-updated', sha: NEW_HEAD_SHA },
        { branch: existing.branch, kind: 'pull-request-updated', number: 23 },
    ]);
    assert.equal(api.commitInputs[0]?.previousManagedHead, OLD_HEAD_SHA);
    assert.deepEqual(api.updatedPullRequests.map(({ number }) => number), [23]);
    const parsed = parseManagedMarker(api.updatedPullRequests[0]?.input.body ?? '');
    assert.equal(parsed.kind, 'valid');
    if (parsed.kind === 'valid') {
        assert.equal(parsed.marker.baseSha, BASE_SHA);
        assert.equal(parsed.marker.managedHeadSha, NEW_HEAD_SHA);
    }
});

test('publication closes an obsolete pull request only while its managed head is unchanged', async () => {
    const obsolete = plannedTarget();
    const existing = managedPullRequest(29, obsolete, OLD_BASE_SHA, OLD_HEAD_SHA);
    const api = new FakePublicationRepository([existing], [[existing.branch, OLD_HEAD_SHA]]);

    const result = await publishManagedPullRequests(publicationInput([]), {
        prepareArtifact: artifactPreparer([]),
        repositoryApi: api,
    });

    assert.deepEqual(result.visibleWrites, [
        { branch: existing.branch, kind: 'pull-request-closed', number: 29 },
    ]);
    assert.deepEqual(api.closedPullRequests, [29]);
});

test('publication does no work for a human-modified managed branch', async () => {
    const target = plannedTarget();
    const existing = managedPullRequest(31, target, OLD_BASE_SHA, OLD_HEAD_SHA, HUMAN_HEAD_SHA);
    const api = new FakePublicationRepository([existing], [[existing.branch, HUMAN_HEAD_SHA]]);

    const result = await publishManagedPullRequests(publicationInput([target]), {
        prepareArtifact: artifactPreparer([]),
        repositoryApi: api,
    });

    assert.equal(result.reconciliation.blocked[0]?.existing.number, 31);
    assert.deepEqual(result.visibleWrites, []);
    assert.deepEqual(api.calls, ['list-open-pull-requests']);
});

test('publication aborts when the default branch advances before ref publication', async () => {
    const target = plannedTarget();
    const api = new FakePublicationRepository([]);
    api.afterCreateCommit = () => { api.defaultHead = ADVANCED_BASE_SHA; };

    await assert.rejects(
        publishManagedPullRequests(publicationInput([target]), {
            prepareArtifact: artifactPreparer([]),
            repositoryApi: api,
        }),
        /default branch advanced after planning/u,
    );
    assert.equal(api.branches.has(renderPullRequestPreview(target).branch), false);
    assert.deepEqual(api.createdPullRequests, []);
});

test('publication treats a non-force refresh race as a failure before updating pull-request metadata', async () => {
    const target = plannedTarget();
    const existing = managedPullRequest(37, target, OLD_BASE_SHA, OLD_HEAD_SHA);
    const api = new FakePublicationRepository([existing], [[existing.branch, OLD_HEAD_SHA]]);
    api.failFastForward = true;

    await assert.rejects(
        publishManagedPullRequests(publicationInput([target]), {
            prepareArtifact: artifactPreparer([]),
            repositoryApi: api,
        }),
        /non-force ref update failed/u,
    );
    assert.equal(api.branches.get(existing.branch), OLD_HEAD_SHA);
    assert.deepEqual(api.updatedPullRequests, []);
});

test('publication reports every completed visible write after a partial API failure', async () => {
    const obsolete = plannedTarget();
    const replacement = plannedTarget('com.example:replacement');
    const existing = managedPullRequest(41, obsolete, OLD_BASE_SHA, OLD_HEAD_SHA);
    const api = new FakePublicationRepository([existing], [[existing.branch, OLD_HEAD_SHA]]);
    api.failCreatePullRequest = true;

    const failure = await publishManagedPullRequests(publicationInput([replacement]), {
        prepareArtifact: artifactPreparer([]),
        repositoryApi: api,
    }).then(() => undefined, (error: unknown) => error);

    assert.ok(failure instanceof ManagedPublicationFailure);
    assert.deepEqual(failure.visibleWrites, [
        { branch: existing.branch, kind: 'pull-request-closed', number: 41 },
        { branch: renderPullRequestPreview(replacement).branch, kind: 'branch-created', sha: NEW_HEAD_SHA },
    ]);
    assert.match(failure.message, /pull-request-closed:#41/u);
    assert.match(failure.message, /branch-created:/u);
    assert.match(failure.message, /pull request creation failed/u);
});

test('publication prepares every artifact before making a safe close visible', async () => {
    const obsolete = plannedTarget();
    const replacement = plannedTarget('com.example:replacement');
    const existing = managedPullRequest(43, obsolete, OLD_BASE_SHA, OLD_HEAD_SHA);
    const api = new FakePublicationRepository([existing], [[existing.branch, OLD_HEAD_SHA]]);

    await assert.rejects(
        publishManagedPullRequests(publicationInput([replacement]), {
            prepareArtifact: async () => { throw new Error('artifact preparation failed'); },
            repositoryApi: api,
        }),
        /artifact preparation failed/u,
    );
    assert.deepEqual(api.closedPullRequests, []);
    assert.equal(api.branches.has(renderPullRequestPreview(replacement).branch), false);
});

function plannedTarget(identifier = 'com.example:demo'): PlannedUpdate {
    const entry = outdatedEntryV2({
        identifier,
        targetId: targetIdFor({ identifier }),
    });
    const target = planUpdates(
        outdatedReportV2([outdatedScopeV2('demo', [entry])]),
        projectSelection(),
        actionInputs(),
    ).eligible[0];
    assert.ok(target);
    return target;
}

function publicationInput(targets: readonly PlannedUpdate[]): ManagedPublicationInput {
    return {
        baseSha: BASE_SHA,
        binary: '/verified/zolt',
        defaultBranch: 'main',
        environment: {},
        includePrereleases: false,
        openPullRequestsLimit: 5,
        repository: repositoryView(),
        repositoryId: '123',
        selection: projectSelection(),
        targets,
    };
}

function managedPullRequest(
    number: number,
    target: PlannedUpdate,
    markerBase: string,
    markerHead: string,
    actualHead = markerHead,
): ExistingPullRequest {
    const rendered = renderManagedPullRequest(target, markerBase, markerHead);
    return {
        baseBranch: 'main',
        body: rendered.body,
        branch: rendered.branch,
        headRepositoryId: '123',
        headSha: actualHead,
        number,
    };
}

function artifactPreparer(prepared: string[]): (
    input: ExactUpdateExecutionInput,
) => Promise<ExactUpdateArtifact> {
    return async ({ target }) => {
        prepared.push(target.managedId);
        return exactArtifact(target);
    };
}

function exactArtifact(target: PlannedUpdate): ExactUpdateArtifact {
    const changedFiles = [target.manifestPath, target.lockfilePath];
    return {
        changedFiles,
        files: changedFiles.map((path) => ({
            content: Buffer.from(`${path}:${target.targetVersion}\n`),
            mode: '100644' as const,
            path,
        })),
        result: {
            applied: true,
            changed: true,
            changedFiles: [target.zoltManifestPath, target.zoltLockfilePath],
            changeClass: target.changeClass,
            command: 'update',
            diagnostics: [],
            dryRun: false,
            fanOut: target.fanOut,
            from: target.currentVersion,
            resolved: true,
            schemaVersion: 2,
            status: 'ok',
            target: {
                identifier: target.identifier,
                lockfilePath: target.zoltLockfilePath,
                manifestPath: target.zoltManifestPath,
                section: target.section,
                surface: target.surface,
                targetId: target.targetId,
                updateable: true,
            },
            to: target.targetVersion,
        },
        target,
    };
}

class FakePublicationRepository implements ManagedPublicationRepository {
    readonly branches: Map<string, string>;
    readonly calls: string[] = [];
    readonly closedPullRequests: number[] = [];
    readonly commitInputs: ManagedCommitInput[] = [];
    readonly createdPullRequests: PullRequestWrite[] = [];
    readonly updatedPullRequests: { readonly input: PullRequestWrite; readonly number: number }[] = [];
    afterCreateCommit: (() => void) | undefined;
    defaultHead = BASE_SHA;
    failCreatePullRequest = false;
    failFastForward = false;

    readonly #openPullRequests: readonly ExistingPullRequest[];

    constructor(
        openPullRequests: readonly ExistingPullRequest[],
        branches: readonly (readonly [string, string])[] = [],
    ) {
        this.#openPullRequests = openPullRequests;
        this.branches = new Map(branches);
    }

    async listOpenPullRequests(): Promise<readonly ExistingPullRequest[]> {
        this.calls.push('list-open-pull-requests');
        return this.#openPullRequests;
    }

    async getDefaultBranchHead(branch: string): Promise<string | null> {
        this.calls.push(`read-default:${branch}`);
        return this.defaultHead;
    }

    async getGeneratedBranchHead(branch: string): Promise<string | null> {
        this.calls.push(`read-managed:${branch}`);
        return this.branches.get(branch) ?? null;
    }

    async createManagedCommit(input: ManagedCommitInput): Promise<string> {
        this.calls.push('create-commit');
        this.commitInputs.push(input);
        this.afterCreateCommit?.();
        return NEW_HEAD_SHA;
    }

    async createGeneratedBranch(branch: string, sha: string): Promise<void> {
        this.calls.push(`create-branch:${branch}`);
        if (this.branches.has(branch)) throw new Error('branch already exists');
        this.branches.set(branch, sha);
    }

    async fastForwardGeneratedBranch(branch: string, sha: string): Promise<void> {
        this.calls.push(`fast-forward:${branch}`);
        if (this.failFastForward) throw new Error('non-force ref update failed');
        this.branches.set(branch, sha);
    }

    async createPullRequest(input: PullRequestWrite): Promise<number> {
        this.calls.push(`create-pull-request:${input.branch}`);
        if (this.failCreatePullRequest) throw new Error('pull request creation failed');
        this.createdPullRequests.push(input);
        return 101;
    }

    async updatePullRequest(number: number, input: PullRequestWrite): Promise<void> {
        this.calls.push(`update-pull-request:${number.toString()}`);
        this.updatedPullRequests.push({ input, number });
    }

    async closePullRequest(number: number): Promise<void> {
        this.calls.push(`close-pull-request:${number.toString()}`);
        this.closedPullRequests.push(number);
    }
}

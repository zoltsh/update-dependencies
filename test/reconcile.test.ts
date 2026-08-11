import * as assert from 'node:assert/strict';
import test from 'node:test';

import { renderManagedMarker } from '../src/github/managed-marker.js';
import {
    reconcileManagedPullRequests,
    type DesiredManagedPullRequest,
    type ExistingPullRequest,
} from '../src/github/reconcile.js';
import { renderPullRequestPreview } from '../src/github/preview.js';
import { managedTargetIdentity } from '../src/planner/identity.js';
import { planUpdates } from '../src/planner/plan.js';
import type { PlannedUpdate } from '../src/types.js';
import {
    actionInputs,
    outdatedEntryV2,
    outdatedReportV2,
    outdatedScopeV2,
    projectSelection,
    testTargetId,
} from './support/fixtures.js';

const BASE_SHA = 'a'.repeat(40);
const ADVANCED_BASE_SHA = 'c'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const REPOSITORY_ID = '123';

function targets(): readonly PlannedUpdate[] {
    const entries = ['alpha', 'beta', 'gamma'].map((name, index) => outdatedEntryV2({
        identifier: `com.example:${name}`,
        targetId: testTargetId(index + 1),
    }));
    return planUpdates(
        outdatedReportV2([outdatedScopeV2('demo', entries)]),
        projectSelection(),
        actionInputs({ openPullRequestsLimit: 100 }),
    ).eligible;
}

function desired(
    targets_: readonly PlannedUpdate[],
    baseSha = BASE_SHA,
): readonly DesiredManagedPullRequest[] {
    return targets_.map((target) => ({ preview: renderPullRequestPreview(target, baseSha), target }));
}

function managedPullRequest(
    number: number,
    target: PlannedUpdate,
    overrides: Partial<ExistingPullRequest> = {},
): ExistingPullRequest {
    return {
        baseBranch: 'main',
        body: renderManagedMarker({
            baseSha: BASE_SHA,
            branchGeneration: BASE_SHA,
            lockfilePath: target.lockfilePath,
            managedHeadSha: HEAD_SHA,
            managedId: target.managedId,
            manifestPath: target.manifestPath,
            schemaVersion: 1,
            targetId: target.targetId,
            targetVersion: target.targetVersion,
            zoltRoot: target.zoltRoot,
        }),
        branch: renderPullRequestPreview(target, BASE_SHA).branch,
        headRepositoryId: REPOSITORY_ID,
        headSha: HEAD_SHA,
        number,
        ...overrides,
    };
}

test('reconciliation refreshes existing targets and fills only remaining open-PR slots', () => {
    const eligible = targets();
    const first = eligible[0];
    assert.ok(first);
    const result = reconcileManagedPullRequests({
        baseSha: ADVANCED_BASE_SHA,
        branchGeneration: ADVANCED_BASE_SHA,
        defaultBranch: 'main',
        desired: desired(eligible, ADVANCED_BASE_SHA),
        existing: [
            managedPullRequest(10, first),
            { baseBranch: 'main', body: 'not managed', branch: 'feature', headRepositoryId: REPOSITORY_ID, headSha: HEAD_SHA, number: 11 },
        ],
        openPullRequestsLimit: 2,
        repositoryId: REPOSITORY_ID,
    });

    assert.deepEqual(result.refresh.map((value) => value.existing.number), [10]);
    assert.equal(result.unchanged.length, 0);
    assert.deepEqual(
        result.create.map((value) => value.target.identifier),
        [eligible[1]?.identifier],
    );
    assert.deepEqual(
        result.deferred.map((value) => value.target.identifier),
        [eligible[2]?.identifier],
    );
    assert.equal(result.ignored.length, 1);
});

test('reconciliation leaves a matching managed PR unchanged on an idempotent rerun', () => {
    const eligible = targets();
    const first = eligible[0];
    assert.ok(first);
    const result = reconcileManagedPullRequests({
        baseSha: BASE_SHA,
        branchGeneration: BASE_SHA,
        defaultBranch: 'main',
        desired: desired(eligible),
        existing: [managedPullRequest(15, first)],
        openPullRequestsLimit: 2,
        repositoryId: REPOSITORY_ID,
    });

    assert.deepEqual(result.unchanged.map((value) => value.existing.number), [15]);
    assert.equal(result.refresh.length, 0);
    assert.deepEqual(
        result.create.map((value) => value.target.identifier),
        [eligible[1]?.identifier],
    );
    assert.deepEqual(
        result.deferred.map((value) => value.target.identifier),
        [eligible[2]?.identifier],
    );
});

test('reconciliation closes safe obsolete targets and reuses their capacity', () => {
    const eligible = targets();
    const first = eligible[0];
    assert.ok(first);
    const obsoleteTargetId = testTargetId(26);
    const obsolete: PlannedUpdate = {
        ...first,
        ...managedTargetIdentity('.', obsoleteTargetId),
        targetId: obsoleteTargetId,
    };
    const result = reconcileManagedPullRequests({
        baseSha: BASE_SHA,
        branchGeneration: BASE_SHA,
        defaultBranch: 'main',
        desired: desired(eligible.slice(0, 2)),
        existing: [managedPullRequest(20, obsolete)],
        openPullRequestsLimit: 2,
        repositoryId: REPOSITORY_ID,
    });

    assert.deepEqual(result.close.map((value) => value.number), [20]);
    assert.equal(result.create.length, 2);
    assert.equal(result.deferred.length, 0);
});

test('reconciliation never refreshes, closes, or duplicates a human-modified managed branch', () => {
    const eligible = targets();
    const first = eligible[0];
    assert.ok(first);
    const result = reconcileManagedPullRequests({
        baseSha: BASE_SHA,
        branchGeneration: BASE_SHA,
        defaultBranch: 'main',
        desired: desired(eligible),
        existing: [managedPullRequest(30, first, { headSha: 'c'.repeat(40) })],
        openPullRequestsLimit: 1,
        repositoryId: REPOSITORY_ID,
    });

    assert.equal(result.refresh.length, 0);
    assert.equal(result.close.length, 0);
    assert.equal(result.create.length, 0);
    assert.equal(result.deferred.length, 2);
    assert.match(result.blocked[0]?.reason ?? '', /branch head changed/u);
});

test('reconciliation blocks duplicate and malformed ownership markers', () => {
    const eligible = targets();
    const first = eligible[0];
    assert.ok(first);
    const duplicate = managedPullRequest(40, first);
    const malformed: ExistingPullRequest = {
        baseBranch: 'main',
        body: '<!-- zolt-update-dependencies:v1:broken+payload -->',
        branch: 'zolt/update/broken-0000000000-0000000000',
        headRepositoryId: REPOSITORY_ID,
        headSha: HEAD_SHA,
        number: 42,
    };
    const result = reconcileManagedPullRequests({
        baseSha: BASE_SHA,
        branchGeneration: BASE_SHA,
        defaultBranch: 'main',
        desired: desired(eligible),
        existing: [duplicate, { ...duplicate, number: 41 }, malformed],
        openPullRequestsLimit: 4,
        repositoryId: REPOSITORY_ID,
    });

    assert.deepEqual(result.blocked.map((value) => value.existing.number), [40, 41, 42]);
    assert.equal(result.refresh.length, 0);
    assert.deepEqual(
        result.create.map((value) => value.target.identifier),
        [eligible[1]?.identifier],
    );
    assert.deepEqual(
        result.deferred.map((value) => value.target.identifier),
        [eligible[2]?.identifier],
    );
});


test('reconciliation will not close an obsolete marker copied onto an unrelated branch', () => {
    const eligible = targets();
    const first = eligible[0];
    assert.ok(first);
    const obsoleteTargetId = testTargetId(25);
    const obsolete: PlannedUpdate = {
        ...first,
        ...managedTargetIdentity('.', obsoleteTargetId),
        targetId: obsoleteTargetId,
    };
    const result = reconcileManagedPullRequests({
        baseSha: BASE_SHA,
        branchGeneration: BASE_SHA,
        defaultBranch: 'main',
        desired: desired(eligible),
        existing: [managedPullRequest(50, obsolete, { branch: 'user/copied-marker' })],
        openPullRequestsLimit: 4,
        repositoryId: REPOSITORY_ID,
    });

    assert.equal(result.close.length, 0);
    assert.equal(result.blocked[0]?.existing.number, 50);
    assert.match(result.blocked[0]?.reason ?? '', /does not own/u);
});


test('reconciliation retains temporarily blocked authoritative targets instead of closing them', () => {
    const eligible = targets();
    const first = eligible[0];
    assert.ok(first);
    const result = reconcileManagedPullRequests({
        baseSha: BASE_SHA,
        branchGeneration: BASE_SHA,
        defaultBranch: 'main',
        desired: desired(eligible.slice(1)),
        existing: [managedPullRequest(60, first)],
        openPullRequestsLimit: 2,
        repositoryId: REPOSITORY_ID,
        retained: [{ managedId: first.managedId, reason: 'Version discovery is temporarily unavailable.' }],
    });

    assert.equal(result.close.length, 0);
    assert.equal(result.blocked[0]?.existing.number, 60);
    assert.match(result.blocked[0]?.reason ?? '', /temporarily unavailable/u);
});

test('reconciliation ignores copied markers from forks or a different base branch', () => {
    const eligible = targets();
    const first = eligible[0];
    assert.ok(first);
    const result = reconcileManagedPullRequests({
        baseSha: BASE_SHA,
        branchGeneration: BASE_SHA,
        defaultBranch: 'main',
        desired: desired(eligible),
        existing: [
            managedPullRequest(70, first, { headRepositoryId: 'fork-456' }),
            managedPullRequest(71, first, { baseBranch: 'release' }),
            {
                baseBranch: 'main',
                body: '<!-- zolt-update-dependencies:v1:broken+payload -->',
                branch: 'zolt/update/copied-0000000000',
                headRepositoryId: 'fork-456',
                headSha: HEAD_SHA,
                number: 72,
            },
        ],
        openPullRequestsLimit: 4,
        repositoryId: REPOSITORY_ID,
    });

    assert.equal(result.refresh.length, 0);
    assert.equal(result.blocked.length, 0);
    assert.equal(result.ignored.length, 3);
    assert.equal(result.create.some(({ target }) => target.managedId === first.managedId), true);
});

test('reconciliation rejects forged desired identities and file boundaries', () => {
    const first = targets()[0];
    assert.ok(first);
    const preview = renderPullRequestPreview(first);

    assert.throws(
        () => reconcileManagedPullRequests({
            baseSha: BASE_SHA,
            branchGeneration: BASE_SHA,
            defaultBranch: 'main',
            desired: [{ preview: { ...preview, branch: 'zolt/update/forged-0000000000' }, target: first }],
            existing: [],
            openPullRequestsLimit: 1,
            repositoryId: REPOSITORY_ID,
        }),
        /inconsistent managed identity/u,
    );
    assert.throws(
        () => reconcileManagedPullRequests({
            baseSha: BASE_SHA,
            branchGeneration: BASE_SHA,
            defaultBranch: 'main',
            desired: [{
                preview,
                target: { ...first, zoltManifestPath: 'other/zolt.toml' },
            }],
            existing: [],
            openPullRequestsLimit: 1,
            repositoryId: REPOSITORY_ID,
        }),
        /inconsistent file boundary/u,
    );
});

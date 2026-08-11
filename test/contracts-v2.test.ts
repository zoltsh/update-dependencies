import * as assert from 'node:assert/strict';
import test from 'node:test';

import { decodeOutdatedReportV2 } from '../src/zolt/contracts-v2.js';
import { decodeExactUpdateResult } from '../src/zolt/exact-contract.js';
import { TEST_TARGET_ID } from './support/fixtures.js';

function outdatedDocument(): Record<string, unknown> {
    return {
        command: 'outdated',
        diagnostics: [],
        notes: [],
        schemaVersion: 2,
        scopes: [{
            entries: [{
                candidates: { major: '2.0.0', minor: '1.1.0', patch: '1.0.1' },
                current: '1.0.0',
                governs: [],
                identifier: 'com.example:demo',
                members: ['apps/api'],
                notes: [],
                section: '[dependencies]',
                selectedInMajor: '1.1.0',
                selectedInMajorClass: 'minor',
                selectedLatest: '2.0.0',
                selectedLatestClass: 'major',
                source: 'central',
                status: 'update-available',
                surface: 'dependency',
                targetId: TEST_TARGET_ID,
                updateBlocker: null,
                updateable: true,
            }],
            label: 'apps/api',
            lockfilePath: 'zolt.lock',
            manifestPath: 'apps/api/zolt.toml',
        }],
        status: 'ok',
    };
}

function exactDocument(): Record<string, unknown> {
    return {
        applied: true,
        changed: true,
        changedFiles: ['apps/api/zolt.toml', 'zolt.lock'],
        class: 'minor',
        command: 'update',
        diagnostics: [],
        dryRun: false,
        fanOut: [],
        from: '1.0.0',
        resolved: true,
        schemaVersion: 2,
        status: 'ok',
        target: {
            identifier: 'com.example:demo',
            lockfilePath: 'zolt.lock',
            manifestPath: 'apps/api/zolt.toml',
            section: '[dependencies]',
            surface: 'dependency',
            targetId: TEST_TARGET_ID,
            updateable: true,
        },
        to: '1.1.0',
    };
}

test('decodeOutdatedReportV2 strictly accepts canonical target identity and paths', () => {
    const report = decodeOutdatedReportV2(JSON.stringify(outdatedDocument()));
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.scopes[0]?.manifestPath, 'apps/api/zolt.toml');
    assert.equal(report.scopes[0]?.entries[0]?.targetId, TEST_TARGET_ID);
    assert.equal(report.scopes[0]?.entries[0]?.updateable, true);
});

test('decodeOutdatedReportV2 rejects malformed identities, paths, and applicability pairs', () => {
    const malformed = outdatedDocument();
    const malformedScopes = malformed.scopes as Array<{ entries: Array<Record<string, unknown>> }>;
    const malformedEntry = malformedScopes[0]?.entries[0];
    assert.ok(malformedEntry);
    malformedEntry.targetId = 'zt1_short';
    assert.throws(() => decodeOutdatedReportV2(JSON.stringify(malformed)), /canonical zt1_/u);

    const nonCanonical = outdatedDocument();
    const nonCanonicalScopes = nonCanonical.scopes as Array<{ entries: Array<Record<string, unknown>> }>;
    const nonCanonicalEntry = nonCanonicalScopes[0]?.entries[0];
    assert.ok(nonCanonicalEntry);
    nonCanonicalEntry.targetId = `zt1_${'A'.repeat(42)}B`;
    assert.throws(() => decodeOutdatedReportV2(JSON.stringify(nonCanonical)), /canonical zt1_/u);

    const unsafe = outdatedDocument();
    const unsafeScopes = unsafe.scopes as Array<Record<string, unknown>>;
    const unsafeScope = unsafeScopes[0];
    assert.ok(unsafeScope);
    unsafeScope.manifestPath = '../zolt.toml';
    assert.throws(() => decodeOutdatedReportV2(JSON.stringify(unsafe)), /canonical repository-relative POSIX/u);

    const wrongManifest = outdatedDocument();
    const wrongManifestScopes = wrongManifest.scopes as Array<Record<string, unknown>>;
    const wrongManifestScope = wrongManifestScopes[0];
    assert.ok(wrongManifestScope);
    wrongManifestScope.manifestPath = 'apps/api/README.md';
    assert.throws(() => decodeOutdatedReportV2(JSON.stringify(wrongManifest)), /zolt\.toml manifest/u);

    const nestedLock = outdatedDocument();
    const nestedLockScopes = nestedLock.scopes as Array<Record<string, unknown>>;
    const nestedLockScope = nestedLockScopes[0];
    assert.ok(nestedLockScope);
    nestedLockScope.lockfilePath = 'locks/zolt.lock';
    assert.throws(() => decodeOutdatedReportV2(JSON.stringify(nestedLock)), /mutation root zolt\.lock/u);

    const trailingSlash = outdatedDocument();
    const trailingSlashScopes = trailingSlash.scopes as Array<Record<string, unknown>>;
    const trailingSlashScope = trailingSlashScopes[0];
    assert.ok(trailingSlashScope);
    trailingSlashScope.manifestPath = 'apps/api/zolt.toml/';
    assert.throws(() => decodeOutdatedReportV2(JSON.stringify(trailingSlash)), /canonical repository-relative POSIX/u);

    const inconsistent = outdatedDocument();
    const inconsistentScopes = inconsistent.scopes as Array<{ entries: Array<Record<string, unknown>> }>;
    const inconsistentEntry = inconsistentScopes[0]?.entries[0];
    assert.ok(inconsistentEntry);
    inconsistentEntry.updateable = false;
    assert.throws(() => decodeOutdatedReportV2(JSON.stringify(inconsistent)), /must explain/u);
});

test('decodeOutdatedReportV2 rejects duplicate manifest scopes and target identities', () => {
    const duplicateTarget = outdatedDocument();
    const targetScopes = duplicateTarget.scopes as Array<{ entries: Array<Record<string, unknown>> }>;
    const firstEntry = targetScopes[0]?.entries[0];
    assert.ok(firstEntry);
    targetScopes[0]?.entries.push({ ...firstEntry });
    assert.throws(() => decodeOutdatedReportV2(JSON.stringify(duplicateTarget)), /repeats target ID/u);

    const duplicateScope = outdatedDocument();
    const scopes = duplicateScope.scopes as Array<Record<string, unknown>>;
    const firstScope = scopes[0];
    assert.ok(firstScope);
    scopes.push({ ...firstScope, entries: [] });
    assert.throws(() => decodeOutdatedReportV2(JSON.stringify(duplicateScope)), /repeats manifest scope/u);
});

test('decodeExactUpdateResult enforces the applied schema-v2 effect contract', () => {
    const result = decodeExactUpdateResult(JSON.stringify(exactDocument()));
    assert.equal(result.target.targetId, TEST_TARGET_ID);
    assert.equal(result.applied, true);
    assert.deepEqual(result.changedFiles, ['apps/api/zolt.toml', 'zolt.lock']);
});

test('decodeExactUpdateResult accepts no-op and no-resolve results but rejects dry-run effects', () => {
    const noOp = exactDocument();
    noOp.applied = false;
    noOp.changed = false;
    noOp.changedFiles = [];
    noOp.class = null;
    noOp.from = '1.1.0';
    noOp.resolved = false;
    noOp.to = '1.1.0';
    assert.equal(decodeExactUpdateResult(JSON.stringify(noOp)).changed, false);

    const noResolve = exactDocument();
    noResolve.resolved = false;
    noResolve.changedFiles = ['apps/api/zolt.toml'];
    assert.equal(decodeExactUpdateResult(JSON.stringify(noResolve)).resolved, false);

    const invalidNoResolve = exactDocument();
    invalidNoResolve.resolved = false;
    assert.throws(
        () => decodeExactUpdateResult(JSON.stringify(invalidNoResolve)),
        /no-resolve exact update/u,
    );

    const wrongOrder = exactDocument();
    wrongOrder.changedFiles = ['zolt.lock', 'apps/api/zolt.toml'];
    assert.throws(
        () => decodeExactUpdateResult(JSON.stringify(wrongOrder)),
        /target manifest followed by the root lockfile/u,
    );

    const outsideBoundary = exactDocument();
    outsideBoundary.changedFiles = ['apps/api/zolt.toml', 'README.md'];
    assert.throws(
        () => decodeExactUpdateResult(JSON.stringify(outsideBoundary)),
        /target manifest followed by the root lockfile/u,
    );

    const contradictory = exactDocument();
    contradictory.dryRun = true;
    assert.throws(
        () => decodeExactUpdateResult(JSON.stringify(contradictory)),
        /dry-run exact update/u,
    );
});

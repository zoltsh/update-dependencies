import * as assert from 'node:assert/strict';
import test from 'node:test';

import {
    parseManagedMarker,
    renderManagedMarker,
    type ManagedPullRequestMarker,
} from '../src/github/managed-marker.js';
import { managedTargetIdentity } from '../src/planner/identity.js';
import { TEST_TARGET_ID } from './support/fixtures.js';

const TARGET_ID = TEST_TARGET_ID;
const MARKER: ManagedPullRequestMarker = {
    baseSha: 'a'.repeat(40),
    lockfilePath: 'services/api/zolt.lock',
    managedHeadSha: 'b'.repeat(40),
    managedId: managedTargetIdentity('services/api', TARGET_ID).managedId,
    manifestPath: 'services/api/apps/web/zolt.toml',
    schemaVersion: 1,
    targetId: TARGET_ID,
    targetVersion: '1.1.0',
    zoltRoot: 'services/api',
};

test('managed pull-request markers round-trip a strict canonical payload', () => {
    const rendered = renderManagedMarker(MARKER);
    const parsed = parseManagedMarker(`Managed by Zolt.\n\n${rendered}\n`);

    assert.equal(parsed.kind, 'valid');
    if (parsed.kind !== 'valid') return;
    assert.deepEqual(parsed.marker, MARKER);
    assert.equal(renderManagedMarker(parsed.marker), rendered);
});

test('managed marker parsing distinguishes unowned bodies from malformed ownership claims', () => {
    assert.deepEqual(parseManagedMarker('ordinary pull request'), { kind: 'none' });
    const malformed = parseManagedMarker(
        '<!-- zolt-update-dependencies:v1:not+base64 -->',
    );
    assert.equal(malformed.kind, 'invalid');

    const duplicate = renderManagedMarker(MARKER);
    assert.equal(parseManagedMarker(`${duplicate}\n${duplicate}`).kind, 'invalid');
});

test('managed marker rendering rejects paths outside the selected Zolt root', () => {
    assert.throws(
        () => renderManagedMarker({ ...MARKER, manifestPath: 'other/zolt.toml' }),
        /inside its Zolt root/u,
    );
    assert.throws(
        () => renderManagedMarker({ ...MARKER, manifestPath: 'services/api/README.md' }),
        /zolt\.toml manifest/u,
    );
    assert.throws(
        () => renderManagedMarker({ ...MARKER, lockfilePath: 'services/api/locks/zolt.lock' }),
        /inside its Zolt root/u,
    );
    assert.throws(
        () => renderManagedMarker({ ...MARKER, targetId: 'zt1_short' }),
        /invalid targetId/u,
    );
    assert.throws(
        () => renderManagedMarker({
            ...MARKER,
            managedId: managedTargetIdentity('.', TARGET_ID).managedId,
        }),
        /does not match/u,
    );
    assert.throws(
        () => renderManagedMarker({ ...MARKER, targetVersion: ' 1.1.0' }),
        /invalid targetVersion/u,
    );
});

import * as assert from 'node:assert/strict';
import test from 'node:test';

import {
    canonicalTargetPath,
    canonicalTargetText,
    createZoltTargetId,
    requireMatchingZoltTargetId,
} from '../src/zolt/target-id.js';

const DEPENDENCY = {
    identifier: 'com.google.guava:guava',
    manifestPath: 'apps/api/zolt.toml',
    section: '[dependencies]',
    surface: 'dependency',
} as const;

test('createZoltTargetId matches Zolt main fixed vectors', () => {
    assert.equal(
        createZoltTargetId(DEPENDENCY),
        'zt1_vcc-lFhiR4a_S4Vab01gw0_gcPDgShIiT8IdjXa5MhM',
    );
    assert.equal(
        createZoltTargetId({
            identifier: 'junit',
            manifestPath: 'zolt.toml',
            section: '[versions]',
            surface: 'versionAlias',
        }),
        'zt1_Ar_b-SXZMAoz9q5_BrDWoPB7EyXy8EIu5r3RDmB6QF8',
    );
    assert.equal(
        createZoltTargetId({
            identifier: 'com.example:lib',
            manifestPath: 'zolt.toml',
            section: '[dependencies]',
            surface: 'dependency',
        }),
        'zt1_7JDO7hkQrBl5dUC14pm3rxY9MvxgOtULf2HZW3iM3j0',
    );
});

test('requireMatchingZoltTargetId binds every canonical identity field', () => {
    const targetId = createZoltTargetId(DEPENDENCY);
    assert.equal(requireMatchingZoltTargetId(targetId, DEPENDENCY, 'targetId'), targetId);
    assert.throws(
        () => requireMatchingZoltTargetId(targetId, { ...DEPENDENCY, section: '[test.dependencies]' }, 'targetId'),
        /does not match its canonical Zolt target identity fields/u,
    );
});

test('canonical target text and paths reject non-NFC, controls, and invalid Unicode', () => {
    assert.equal(canonicalTargetText('com.example:lib', 'identifier'), 'com.example:lib');
    assert.equal(canonicalTargetPath('apps/api/zolt.toml', 'manifestPath'), 'apps/api/zolt.toml');
    for (const invalid of ['cafe\u0301', 'line\u0085break', '\uD800']) {
        assert.throws(() => canonicalTargetText(invalid, 'identity'), /canonical Unicode NFC text/u);
    }
    for (const invalid of ['/zolt.toml', './zolt.toml', 'apps/../zolt.toml', 'apps\\api\\zolt.toml']) {
        assert.throws(() => canonicalTargetPath(invalid, 'manifestPath'), /relative POSIX path|normalized/u);
    }
});

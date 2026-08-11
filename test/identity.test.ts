import * as assert from 'node:assert/strict';
import test from 'node:test';

import { managedTargetIdentity } from '../src/planner/identity.js';
import { TEST_TARGET_ID } from './support/fixtures.js';

test('managed target identity has fixed repository-root vectors', () => {
    assert.deepEqual(managedTargetIdentity('.', TEST_TARGET_ID), {
        branchHash: 'f69492e69e',
        managedId: 'zud1_9pSS5p436s4oqrne8583mmMGD7OvHRZTS_WenPeQkMo',
        targetId: TEST_TARGET_ID,
    });
    assert.deepEqual(managedTargetIdentity('services/api', TEST_TARGET_ID), {
        branchHash: '5596e12d16',
        managedId: 'zud1_VZbhLRaw-AjkT05rtyrv_20ZXill1EaKJZ5VFx7KX5o',
        targetId: TEST_TARGET_ID,
    });
});

test('managed target identity rejects malformed target IDs', () => {
    assert.throws(
        () => managedTargetIdentity('.', 'zt1_short'),
        /canonical Zolt or preview target ID/u,
    );
    assert.throws(
        () => managedTargetIdentity('../escape', TEST_TARGET_ID),
        /canonical repository-relative POSIX path/u,
    );
    assert.throws(
        () => managedTargetIdentity('.', `zt1_${'A'.repeat(42)}B`),
        /canonical Zolt or preview target ID/u,
    );
});

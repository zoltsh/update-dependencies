import * as assert from 'node:assert/strict';
import test from 'node:test';

import { managedTargetIdentity } from '../src/planner/identity.js';
import { TEST_TARGET_ID } from './support/fixtures.js';

test('managed target identity has fixed repository-root vectors', () => {
    assert.deepEqual(managedTargetIdentity('.', TEST_TARGET_ID), {
        branchHash: 'a1890258a9',
        managedId: 'zud1_oYkCWKnkLzvubLFLA44hKxOEY6A_UYxR_IBs4Y4Ce00',
        targetId: TEST_TARGET_ID,
    });
    assert.deepEqual(managedTargetIdentity('services/api', TEST_TARGET_ID), {
        branchHash: '4cf2eff3c4',
        managedId: 'zud1_TPLv88QHKQDcCBJ-h6hrv7_zLlV3pqDd_gBRfRg6c9g',
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

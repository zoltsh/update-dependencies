import * as assert from 'node:assert/strict';
import test from 'node:test';

import { decodeMachineFailure, machineFailureMessage } from '../src/zolt/failure-contract.js';

function failureDocument(command: 'outdated' | 'update', schemaVersion: 1 | 2): string {
    return JSON.stringify({
        command,
        diagnostics: [{
            message: 'The selected target is stale.',
            nextStep: 'Run zolt outdated again.',
            severity: 'error',
        }],
        schemaVersion,
        status: 'failed',
    });
}

test('decodeMachineFailure accepts the stable selected-schema envelope', () => {
    const failure = decodeMachineFailure(failureDocument('update', 2), 'update', 2);
    assert.equal(failure.schemaVersion, 2);
    assert.equal(
        machineFailureMessage(failure),
        'The selected target is stale. Next: Run zolt outdated again.',
    );
});

test('decodeMachineFailure rejects wrong schemas, commands, and diagnostics', () => {
    assert.throws(
        () => decodeMachineFailure(failureDocument('update', 1), 'update', 2),
        /schemaVersion must equal 2/u,
    );
    assert.throws(
        () => decodeMachineFailure(failureDocument('outdated', 2), 'update', 2),
        /command must equal update/u,
    );
    const empty = JSON.stringify({ command: 'update', diagnostics: [], schemaVersion: 2, status: 'failed' });
    assert.throws(() => decodeMachineFailure(empty, 'update', 2), /at least one diagnostic/u);
});

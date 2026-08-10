import * as assert from 'node:assert/strict';
import test from 'node:test';

import { decodeOutdatedReport } from '../src/zolt/contracts.js';

function document(): Record<string, unknown> {
    return {
        command: 'outdated',
        diagnostics: [{ message: 'shared alias', severity: 'warning' }],
        notes: ['one workspace note'],
        schemaVersion: 1,
        scopes: [{
            entries: [{
                candidates: { major: '2.0.0', minor: '1.1.0', patch: '1.0.1' },
                current: '1.0.0',
                governs: ['[dependencies].com.example:demo'],
                identifier: 'demo',
                members: ['apps/api'],
                notes: [],
                section: '[versions]',
                selectedInMajor: '1.1.0',
                selectedInMajorClass: 'minor',
                selectedLatest: '2.0.0',
                selectedLatestClass: 'major',
                source: 'central',
                status: 'update-available',
                surface: 'versionAlias',
            }],
            label: 'apps/api',
        }],
        status: 'ok',
    };
}

test('decodeOutdatedReport strictly decodes Zolt schema v1', () => {
    const decoded = decodeOutdatedReport(JSON.stringify(document()));
    assert.equal(decoded.scopes[0]?.entries[0]?.status, 'updateAvailable');
    assert.equal(decoded.scopes[0]?.entries[0]?.surface, 'versionAlias');
    assert.deepEqual(decoded.diagnostics, [{ message: 'shared alias', severity: 'warning' }]);
});

test('decodeOutdatedReport fails closed on unknown fields and unsupported values', () => {
    const withUnknown = document();
    withUnknown.extra = true;
    assert.throws(() => decodeOutdatedReport(JSON.stringify(withUnknown)), /unknown or missing fields/u);

    const badStatus = document();
    const scopes = badStatus.scopes as Array<{ entries: Array<Record<string, unknown>> }>;
    scopes[0]?.entries[0] && (scopes[0].entries[0].status = 'surprising');
    assert.throws(() => decodeOutdatedReport(JSON.stringify(badStatus)), /unsupported value surprising/u);
});

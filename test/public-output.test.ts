import * as assert from 'node:assert/strict';
import test from 'node:test';

import { actionError } from '../src/errors.js';
import { publicErrorMessage, publicJson, publicText, registeredSecrets } from '../src/public-output.js';

test('public output strips controls and redacts raw, encoded, and base64 secrets', () => {
    const secret = 'p@ss/word';
    const rendered = publicText(
        `raw=${secret} url=${encodeURIComponent(secret)} b64=${Buffer.from(secret).toString('base64')}\u001B[31m\u0000`,
        [secret],
    );
    assert.equal(rendered.includes(secret), false);
    assert.equal(rendered.includes(encodeURIComponent(secret)), false);
    assert.equal(rendered.includes(Buffer.from(secret).toString('base64')), false);
    assert.equal(rendered.includes('\u001B'), false);
});

test('publicJson redacts quoted secrets while preserving valid JSON', () => {
    const secret = 'quoted\"secret';
    const rendered = publicJson([{ identifier: secret, version: '1.0.0' }], [secret]);
    assert.deepEqual(JSON.parse(rendered), [{ identifier: '[REDACTED]', version: '1.0.0' }]);
});

test('registeredSecrets finds credential-like environment names and errors retain codes', () => {
    assert.deepEqual(registeredSecrets({ MAVEN_PASSWORD: 'password-value', NORMAL: 'visible' }), ['password-value']);
    assert.match(publicErrorMessage(actionError('ZOLT-TEST-001', 'failed'), []), /^ZOLT-TEST-001: failed$/u);
});

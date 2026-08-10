import * as assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createZoltEnvironment } from '../src/zolt/process.js';

test('createZoltEnvironment passes only baseline and selected registry variables', async (context) => {
    const temporary = await mkdtemp(join(tmpdir(), 'zolt-credentials-test-'));
    context.after(async () => rm(temporary, { force: true, recursive: true }));
    const secrets: string[] = [];
    const created = await createZoltEnvironment({
        HOME: '/must/not/pass',
        MAVEN_PASSWORD: 'registry-password',
        PATH: '/usr/bin',
        RUNNER_TEMP: temporary,
        UNRELATED: 'nope',
    }, ['MAVEN_PASSWORD'], 'github-token-value', (value) => secrets.push(value));

    assert.equal(created.environment.PATH, '/usr/bin');
    assert.equal(created.environment.MAVEN_PASSWORD, 'registry-password');
    assert.equal(created.environment.UNRELATED, undefined);
    assert.equal(created.environment.HOME, undefined);
    assert.deepEqual(secrets, ['registry-password']);
    const home = created.environment.ZOLT_USER_HOME;
    assert.ok(home);
    await access(home);
    await created.cleanup();
    await assert.rejects(access(home));
});

test('createZoltEnvironment rejects missing and token-derived registry credentials', async () => {
    await assert.rejects(
        createZoltEnvironment({}, ['MISSING'], 'github-token-value', () => undefined),
        /selected MISSING, but it is not set/u,
    );
    await assert.rejects(
        createZoltEnvironment({ MAVEN_TOKEN: 'prefix-github-token-value-suffix' }, ['MAVEN_TOKEN'], 'github-token-value', () => undefined),
        /contains the GitHub pull request token/u,
    );
});

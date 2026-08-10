import * as assert from 'node:assert/strict';
import test from 'node:test';

import { readExecutionContext } from '../src/environment/context.js';

const payload = JSON.stringify({
    ref: 'refs/heads/main',
    repository: { default_branch: 'main', full_name: 'zoltsh/example' },
});

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'schedule',
        GITHUB_EVENT_PATH: '/event.json',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_REPOSITORY: 'zoltsh/example',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: 'a'.repeat(40),
        GITHUB_WORKSPACE: '/repo',
        ...overrides,
    };
}

test('readExecutionContext accepts an exact default-branch event', async () => {
    const context = await readExecutionContext(environment(), async () => payload);
    assert.equal(context.defaultBranch, 'main');
    assert.equal(context.repository, 'zoltsh/example');
    assert.equal(context.sha, 'a'.repeat(40));
});

test('readExecutionContext rejects pull requests, non-default refs, and repository mismatches', async () => {
    await assert.rejects(
        readExecutionContext(environment({ GITHUB_EVENT_NAME: 'pull_request' }), async () => payload),
        /Event pull_request is not supported/u,
    );
    await assert.rejects(
        readExecutionContext(environment({ GITHUB_REF: 'refs/heads/feature' }), async () => payload),
        /default branch main/u,
    );
    await assert.rejects(
        readExecutionContext(environment(), async () => JSON.stringify({
            repository: { default_branch: 'main', full_name: 'other/repository' },
        })),
        /does not match/u,
    );
});

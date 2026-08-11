import * as assert from 'node:assert/strict';
import test from 'node:test';

import { readExecutionContext } from '../src/environment/context.js';

const payload = JSON.stringify({
    ref: 'refs/heads/main',
    repository: { default_branch: 'main', full_name: 'zoltsh/example', id: 123_456 },
});

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'schedule',
        GITHUB_EVENT_PATH: '/event.json',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_REPOSITORY: 'zoltsh/example',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_RUN_ID: '123456789',
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
    assert.equal(context.repositoryId, '123456');
    assert.match(context.publicationGeneration, /^[0-9a-f]{64}$/u);
    assert.equal(context.sha, 'a'.repeat(40));
    const retry = await readExecutionContext(
        environment({ GITHUB_RUN_ATTEMPT: '2' }),
        async () => payload,
    );
    assert.notEqual(retry.publicationGeneration, context.publicationGeneration);
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
            repository: { default_branch: 'main', full_name: 'other/repository', id: 123_456 },
        })),
        /does not match/u,
    );
    await assert.rejects(
        readExecutionContext(environment(), async () => JSON.stringify({
            repository: { default_branch: 'main', full_name: 'zoltsh/example', id: 0 },
        })),
        /repository\.id is missing or invalid/u,
    );
    await assert.rejects(
        readExecutionContext(environment({ GITHUB_RUN_ATTEMPT: '0' }), async () => payload),
        /GITHUB_RUN_ATTEMPT is invalid/u,
    );
});

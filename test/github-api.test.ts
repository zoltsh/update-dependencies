import * as assert from 'node:assert/strict';
import test from 'node:test';

import {
    createGitHubRequester,
    type GitHubJsonRequest,
    type GitHubJsonResponse,
} from '../src/github/api-client.js';
import { GitHubRepositoryApi } from '../src/github/repository-api.js';
import { canonicalCommitFiles } from '../src/github/repository-values.js';
import type { UpdateArtifactFile } from '../src/types.js';

const BASE = 'a'.repeat(40);
const PREVIOUS = 'b'.repeat(40);
const BASE_TREE = 'c'.repeat(40);
const MANIFEST_BLOB = 'd'.repeat(40);
const LOCK_BLOB = 'e'.repeat(40);
const UPDATED_TREE = 'f'.repeat(40);
const COMMIT = '1'.repeat(40);

interface RecordedFetch {
    readonly init: RequestInit;
    readonly url: string;
}

test('createGitHubRequester pins GitHub.com, API version, token, and bounded JSON', async () => {
    const calls: RecordedFetch[] = [];
    const requester = createGitHubRequester('secret-token', {
        fetcher: async (input, init) => {
            calls.push({ init: init ?? {}, url: String(input) });
            return new Response(JSON.stringify({ ok: true }), {
                headers: { 'content-length': '11', 'content-type': 'application/json' },
                status: 200,
            });
        },
        timeoutMilliseconds: 1000,
    });

    const response = await requester({ method: 'GET', path: '/repos/zoltsh/demo' });
    assert.deepEqual(response, { status: 200, value: { ok: true } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://api.github.com/repos/zoltsh/demo');
    const headers = new Headers(calls[0]?.init.headers);
    assert.equal(headers.get('authorization'), 'Bearer secret-token');
    assert.equal(headers.get('x-github-api-version'), '2026-03-10');
    assert.equal(calls[0]?.init.redirect, 'error');

    await assert.rejects(
        requester({ method: 'GET', path: 'https://example.com/repos/zoltsh/demo' }),
        /request path is invalid/u,
    );
    await assert.rejects(
        requester({ method: 'GET', path: '/repos/zoltsh/demo#fragment' }),
        /request path is invalid/u,
    );
    await assert.rejects(
        requester({ body: 1n, method: 'POST', path: '/repos/zoltsh/demo/git/blobs' }),
        /not JSON-serializable/u,
    );
    assert.throws(
        () => createGitHubRequester('', { fetcher: async () => new Response() }),
        /non-empty, bounded GitHub token/u,
    );
    assert.throws(
        () => createGitHubRequester(' token', { fetcher: async () => new Response() }),
        /without whitespace or control characters/u,
    );
    assert.throws(
        () => createGitHubRequester('token\nheader', { fetcher: async () => new Response() }),
        /without whitespace or control characters/u,
    );
    assert.throws(
        () => createGitHubRequester('token value', { fetcher: async () => new Response() }),
        /without whitespace or control characters/u,
    );
    assert.throws(
        () => createGitHubRequester('x'.repeat(4097), { fetcher: async () => new Response() }),
        /bounded GitHub token/u,
    );
    assert.throws(
        () => createGitHubRequester('token', { apiUrl: 'https://github.example/api/v3' }),
        /Only the GitHub\.com API origin/u,
    );
});

test('createGitHubRequester rejects malformed or excessive responses', async () => {
    const malformed = createGitHubRequester('token', {
        fetcher: async () => new Response('{', { status: 200 }),
    });
    await assert.rejects(
        malformed({ method: 'GET', path: '/zen' }),
        /malformed JSON/u,
    );

    const excessive = createGitHubRequester('token', {
        fetcher: async () => new Response('{}', {
            headers: { 'content-length': String(16 * 1024 * 1024 + 1) },
            status: 200,
        }),
    });
    await assert.rejects(
        excessive({ method: 'GET', path: '/zen' }),
        /excessive Content-Length/u,
    );
});

test('GitHubRepositoryApi builds a refresh commit from the current base and managed head', async () => {
    const requests: GitHubJsonRequest[] = [];
    const replies: GitHubJsonResponse[] = [
        { status: 200, value: { tree: { sha: BASE_TREE } } },
        { status: 201, value: { sha: MANIFEST_BLOB } },
        { status: 201, value: { sha: LOCK_BLOB } },
        { status: 201, value: { sha: UPDATED_TREE } },
        { status: 201, value: { sha: COMMIT } },
    ];
    const api = repositoryApi(requests, replies);
    const files = updateFiles();

    const commit = await api.createManagedCommit({
        baseSha: BASE,
        files,
        message: 'build(deps): bump demo from 1.0.0 to 1.1.0',
        previousManagedHead: PREVIOUS,
    });

    assert.equal(commit, COMMIT);
    assert.deepEqual(requests.map(({ method, path }) => ({ method, path })), [
        { method: 'GET', path: `/repos/zoltsh/demo/git/commits/${BASE}` },
        { method: 'POST', path: '/repos/zoltsh/demo/git/blobs' },
        { method: 'POST', path: '/repos/zoltsh/demo/git/blobs' },
        { method: 'POST', path: '/repos/zoltsh/demo/git/trees' },
        { method: 'POST', path: '/repos/zoltsh/demo/git/commits' },
    ]);
    assert.deepEqual(requests[1]?.body, {
        content: files[0]?.content.toString('base64'),
        encoding: 'base64',
    });
    assert.deepEqual(requests[3]?.body, {
        base_tree: BASE_TREE,
        tree: [
            { mode: '100644', path: 'apps/api/zolt.toml', sha: MANIFEST_BLOB, type: 'blob' },
            { mode: '100644', path: 'zolt.lock', sha: LOCK_BLOB, type: 'blob' },
        ],
    });
    assert.deepEqual(requests[4]?.body, {
        message: 'build(deps): bump demo from 1.0.0 to 1.1.0',
        parents: [PREVIOUS, BASE],
        tree: UPDATED_TREE,
    });
});

test('GitHubRepositoryApi manages refs and pull requests through validated endpoints', async () => {
    const requests: GitHubJsonRequest[] = [];
    const branch = 'zolt/update/demo-0123456789-aaaaaaaaaa';
    const replies: GitHubJsonResponse[] = [
        { status: 200, value: { object: { sha: BASE } } },
        { status: 404, value: { message: 'Not Found' } },
        { status: 201, value: { ref: `refs/heads/${branch}` } },
        { status: 200, value: { ref: `refs/heads/${branch}` } },
        {
            status: 200,
            value: [{
                base: { ref: 'main' },
                body: 'managed body',
                head: { ref: branch, repo: { id: 123 }, sha: COMMIT },
                number: 17,
            }],
        },
        { status: 201, value: { number: 18 } },
        { status: 200, value: { number: 18 } },
        { status: 200, value: { number: 18, state: 'closed' } },
    ];
    const api = repositoryApi(requests, replies);

    assert.equal(await api.getDefaultBranchHead('main'), BASE);
    assert.equal(await api.getGeneratedBranchHead(branch), null);
    await api.createGeneratedBranch(branch, COMMIT);
    await api.fastForwardGeneratedBranch(branch, COMMIT);
    const open = await api.listOpenPullRequests();
    assert.deepEqual(open, [{
        baseBranch: 'main',
        body: 'managed body',
        branch,
        headRepositoryId: '123',
        headSha: COMMIT,
        number: 17,
    }]);
    assert.equal(await api.createPullRequest({
        baseBranch: 'main',
        body: 'body',
        branch,
        title: 'build(deps): bump demo',
    }), 18);
    await api.updatePullRequest(18, {
        baseBranch: 'main',
        body: 'updated body',
        branch,
        title: 'build(deps): bump demo again',
    });
    await api.closePullRequest(18);

    assert.equal(requests[0]?.path, '/repos/zoltsh/demo/git/ref/heads/main');
    assert.equal(
        requests[1]?.path,
        '/repos/zoltsh/demo/git/ref/heads/zolt/update/demo-0123456789-aaaaaaaaaa',
    );
    assert.deepEqual(requests[2]?.body, { ref: `refs/heads/${branch}`, sha: COMMIT });
    assert.deepEqual(requests[3]?.body, { force: false, sha: COMMIT });
    assert.equal(
        requests[4]?.path,
        '/repos/zoltsh/demo/pulls?state=open&sort=created&direction=asc&per_page=100&page=1',
    );
    assert.deepEqual(requests[5]?.body, {
        base: 'main',
        body: 'body',
        draft: false,
        head: branch,
        maintainer_can_modify: false,
        title: 'build(deps): bump demo',
    });
    assert.deepEqual(requests[7]?.body, { state: 'closed' });
});

test('canonicalCommitFiles copies bytes and rejects duplicate boundaries', () => {
    const source = Buffer.from('manifest');
    const canonical = canonicalCommitFiles([
        { content: source, mode: '100644', path: 'zolt.toml' },
    ]);
    source.fill(0);
    assert.equal(canonical[0]?.content.toString('utf8'), 'manifest');

    assert.throws(
        () => canonicalCommitFiles([
            { content: Buffer.from('one'), mode: '100644', path: 'zolt.toml' },
            { content: Buffer.from('two'), mode: '100644', path: 'zolt.toml' },
        ]),
        /Duplicate update commit path/u,
    );
    assert.throws(
        () => canonicalCommitFiles([
            { content: Buffer.alloc(16 * 1024 * 1024 + 1), mode: '100644', path: 'zolt.lock' },
        ]),
        /too large/u,
    );
});

function repositoryApi(
    requests: GitHubJsonRequest[],
    replies: GitHubJsonResponse[],
): GitHubRepositoryApi {
    return new GitHubRepositoryApi({
        owner: 'zoltsh',
        repository: 'demo',
        requester: async (request) => {
            requests.push(request);
            const response = replies.shift();
            assert.ok(response, `unexpected GitHub request ${request.method} ${request.path}`);
            return response;
        },
    });
}

function updateFiles(): readonly UpdateArtifactFile[] {
    return [
        { content: Buffer.from('version = "1.1.0"\n'), mode: '100644', path: 'apps/api/zolt.toml' },
        { content: Buffer.from('dependency = "demo:1.1.0"\n'), mode: '100644', path: 'zolt.lock' },
    ];
}

test('createGitHubRequester rejects control-bearing paths and does not expose tokens in failures', async () => {
    const token = 'token-that-must-not-appear';
    let called = false;
    const requester = createGitHubRequester(token, {
        fetcher: async () => {
            called = true;
            throw new Error('network unavailable');
        },
    });

    await assert.rejects(
        requester({ method: 'GET', path: '/repos/zoltsh/demo\nattack' }),
        /request path is invalid/u,
    );
    assert.equal(called, false);

    const failure = await requester({ method: 'GET', path: '/repos/zoltsh/demo' })
        .then(() => undefined, (error: unknown) => error);
    assert.ok(failure instanceof Error);
    assert.doesNotMatch(failure.message, new RegExp(token, 'u'));
    assert.match(failure.message, /failed before a response/u);
});

test('GitHubRepositoryApi fails safely on ref races and malformed API identities', async () => {
    const branch = 'zolt/update/demo-0123456789-aaaaaaaaaa';
    const requests: GitHubJsonRequest[] = [];
    const api = repositoryApi(requests, [
        { status: 422, value: { message: 'Update is not a fast forward' } },
        { status: 200, value: { object: { sha: 'short' } } },
    ]);

    await assert.rejects(
        () => api.fastForwardGeneratedBranch(branch, COMMIT),
        /HTTP 422/u,
    );
    assert.deepEqual(requests[0]?.body, { force: false, sha: COMMIT });
    await assert.rejects(
        () => api.getGeneratedBranchHead(branch),
        /SHA is invalid/u,
    );
    await assert.rejects(
        () => api.createGeneratedBranch('feature/user-branch', COMMIT),
        /managed branch name is invalid/u,
    );

    const malformedPulls = repositoryApi([], [{
        status: 200,
        value: [{
            base: { ref: 'main' },
            body: 'x'.repeat(128 * 1024 + 1),
            head: { ref: branch, repo: { id: 123 }, sha: COMMIT },
            number: 1,
        }],
    }]);
    await assert.rejects(
        () => malformedPulls.listOpenPullRequests(),
        /excessive pull request body/u,
    );
});

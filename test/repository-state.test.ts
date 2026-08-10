import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { createRepositoryView } from '../src/environment/repository-state.js';

const execute = promisify(execFile);

test('createRepositoryView reads the exact commit and ignores dirty checkout files', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'zolt-repository-test-'));
    const runnerTemp = await mkdtemp(join(tmpdir(), 'zolt-repository-private-'));
    context.after(async () => Promise.all([
        rm(root, { force: true, recursive: true }),
        rm(runnerTemp, { force: true, recursive: true }),
    ]).then(() => undefined));
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await writeFile(join(root, 'zolt.toml'), '[project]\nname = "committed"\n', 'utf8');
    await writeFile(join(root, 'zolt.lock'), 'version = 1\n', 'utf8');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'initial']);
    const sha = (await git(root, ['rev-parse', 'HEAD'])).trim();
    await writeFile(join(root, 'zolt.toml'), '[project]\nname = "dirty"\n', 'utf8');

    const view = await createRepositoryView({ directory: '.', expectedSha: sha, workspace: root }, {
        environment: { RUNNER_TEMP: runnerTemp },
    });
    assert.match(await readFile(join(view.workspace, 'zolt.toml'), 'utf8'), /committed/u);
    assert.notEqual(view.workspace, root);
    await view.cleanup();
});

test('createRepositoryView rejects committed symbolic links', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'zolt-repository-test-'));
    context.after(async () => rm(root, { force: true, recursive: true }));
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await writeFile(join(root, 'target'), 'value\n', 'utf8');
    await symlink('target', join(root, 'link'));
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'link']);
    const sha = (await git(root, ['rev-parse', 'HEAD'])).trim();

    await assert.rejects(
        createRepositoryView({ directory: '.', expectedSha: sha, workspace: root }),
        /symlink, submodule, or unsupported object/u,
    );
});

async function git(cwd: string, arguments_: readonly string[]): Promise<string> {
    const result = await execute('git', arguments_, { cwd, encoding: 'utf8' });
    return result.stdout;
}

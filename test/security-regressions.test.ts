import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { ExecutionContext } from '../src/environment/context.js';
import { createRepositoryView } from '../src/environment/repository-state.js';
import { publicJson } from '../src/public-output.js';
import { runAction } from '../src/main.js';
import type { RepositoryView, ZoltProjectSelection } from '../src/types.js';
import { selectZoltProject } from '../src/zolt/workspace.js';
import { FakeActionCore } from './support/core.js';

const execution: ExecutionContext = {
    defaultBranch: 'main',
    eventName: 'schedule',
    ref: 'refs/heads/main',
    repository: 'zoltsh/example',
    sha: 'a'.repeat(40),
    workspace: '/checkout',
};

const repository: RepositoryView = {
    cleanup: async () => undefined,
    directory: '/private/repository',
    directoryInput: '.',
    workspace: '/private/repository',
};

const selection: ZoltProjectSelection = {
    lockfilePath: 'zolt.lock',
    manifestPath: 'zolt.toml',
    mode: 'project',
    relativeRoot: '.',
    root: '/private/repository',
};

test('createRepositoryView rejects revision expressions at its own boundary', async () => {
    await assert.rejects(
        createRepositoryView({ directory: '.', expectedSha: 'HEAD', workspace: '/unused' }),
        /must be a full 40- or 64-character commit SHA/u,
    );
});

test('selectZoltProject reports both workspace formats at the repository root', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'zolt-dual-workspace-test-'));
    context.after(async () => rm(root, { force: true, recursive: true }));
    await writeFile(join(root, 'zolt.toml'), '[workspace]\nmembers = []\n', 'utf8');
    await writeFile(join(root, 'zolt-workspace.toml'), 'members = []\n', 'utf8');
    await writeFile(join(root, 'zolt.lock'), 'version = 5\n', 'utf8');

    await assert.rejects(
        selectZoltProject({ cleanup: async () => undefined, directory: root, directoryInput: '.', workspace: root }, 'auto'),
        /Workspace at \. declares both/u,
    );
});

test('missing registry credentials fail before the pinned release is downloaded', async () => {
    const core = new FakeActionCore({
        'github-token': 'github-token-value',
        'registry-env': 'MAVEN_PASSWORD',
    });
    let installed = false;

    await runAction({
        architecture: 'x64',
        core,
        createRepository: async () => repository,
        environment: {},
        install: async () => {
            installed = true;
            throw new Error('installer should not run');
        },
        platform: 'linux',
        readContext: async () => execution,
        selectProject: async () => selection,
    });

    assert.equal(installed, false);
    assert.match(core.failures[0] ?? '', /MAVEN_PASSWORD, but it is not set/u);
});

test('publicJson rejects values that JSON cannot represent', () => {
    assert.throws(() => publicJson(undefined, []), /could not be encoded as JSON/u);
});

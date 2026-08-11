import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { selectZoltProject } from '../src/zolt/workspace.js';
import { repositoryView } from './support/fixtures.js';

test('selectZoltProject discovers a modern workspace above the selected member', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'zolt-workspace-test-'));
    context.after(async () => rm(root, { force: true, recursive: true }));
    await mkdir(join(root, 'apps', 'api'), { recursive: true });
    await writeFile(join(root, 'zolt.toml'), '[workspace]\nmembers = ["apps/api"]\n', 'utf8');
    await writeFile(join(root, 'zolt.lock'), 'version = 5\n', 'utf8');
    await writeFile(join(root, 'apps', 'api', 'zolt.toml'), '[project]\nname = "api"\n', 'utf8');

    const selection = await selectZoltProject(repository(root, join(root, 'apps', 'api'), 'apps/api'), 'auto');
    assert.equal(selection.mode, 'workspace');
    assert.equal(selection.manifestPath, 'zolt.toml');
    assert.equal(selection.lockfilePath, 'zolt.lock');
    assert.equal(selection.relativeRoot, '.');
});

test('selectZoltProject supports legacy workspaces and standalone projects', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'zolt-workspace-test-'));
    context.after(async () => rm(root, { force: true, recursive: true }));
    await mkdir(join(root, 'member'), { recursive: true });
    await writeFile(join(root, 'zolt-workspace.toml'), 'members = ["member"]\n', 'utf8');
    await writeFile(join(root, 'zolt.lock'), 'version = 5\n', 'utf8');
    await writeFile(join(root, 'member', 'zolt.toml'), '[project]\nname = "member"\n', 'utf8');
    const legacy = await selectZoltProject(repository(root, join(root, 'member'), 'member'), 'true');
    assert.equal(legacy.mode, 'workspace');
    assert.equal(legacy.manifestPath, 'zolt-workspace.toml');

    const standaloneRoot = join(root, 'standalone');
    await mkdir(standaloneRoot);
    await writeFile(join(standaloneRoot, 'zolt.toml'), '[project]\nname = "standalone"\n', 'utf8');
    await writeFile(join(standaloneRoot, 'zolt.lock'), 'version = 1\n', 'utf8');
    const standalone = await selectZoltProject(repository(root, standaloneRoot, 'standalone'), 'false');
    assert.equal(standalone.mode, 'project');
    assert.equal(standalone.manifestPath, 'standalone/zolt.toml');
});

test('selectZoltProject canonicalizes repository path aliases', async (context) => {
    const temporary = await mkdtemp(join(tmpdir(), 'zolt-workspace-alias-test-'));
    context.after(async () => rm(temporary, { force: true, recursive: true }));
    const physicalRoot = join(temporary, 'physical');
    const aliasedRoot = join(temporary, 'alias');
    await mkdir(join(physicalRoot, 'member'), { recursive: true });
    await writeFile(join(physicalRoot, 'zolt.toml'), '[workspace]\nmembers = ["member"]\n', 'utf8');
    await writeFile(join(physicalRoot, 'zolt.lock'), 'version = 5\n', 'utf8');
    await writeFile(join(physicalRoot, 'member', 'zolt.toml'), '[project]\nname = "member"\n', 'utf8');
    await symlink(physicalRoot, aliasedRoot, 'dir');

    const selection = await selectZoltProject(
        repository(aliasedRoot, join(aliasedRoot, 'member'), 'member'),
        'true',
    );
    assert.equal(selection.mode, 'workspace');
    assert.equal(selection.root, await realpath(physicalRoot));
    assert.equal(selection.manifestPath, 'zolt.toml');
    assert.equal(selection.lockfilePath, 'zolt.lock');
});

function repository(workspace: string, directory: string, directoryInput: string) {
    return repositoryView({ directory, directoryInput, workspace });
}

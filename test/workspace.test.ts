import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { RepositoryView } from '../src/types.js';
import { selectZoltProject } from '../src/zolt/workspace.js';

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

function repository(workspace: string, directory: string, directoryInput: string): RepositoryView {
    return {
        cleanup: async () => undefined,
        directory,
        verify: async () => undefined,
        directoryInput,
        workspace,
    };
}

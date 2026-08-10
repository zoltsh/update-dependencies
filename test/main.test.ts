import * as assert from 'node:assert/strict';
import test from 'node:test';

import type { ExecutionContext } from '../src/environment/context.js';
import type { InstalledZolt } from '../src/install/install-zolt.js';
import { runAction } from '../src/main.js';
import type { RepositoryView, ZoltProjectSelection } from '../src/types.js';
import type { ZoltEnvironment } from '../src/zolt/process.js';
import { outdatedReport } from './support/fixtures.js';
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
    verify: async () => undefined,
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

test('runAction produces a deterministic planning summary and output without write operations', async () => {
    const core = new FakeActionCore({ 'github-token': 'github-token-value' });
    const cleanups: string[] = [];
    let verified = false;
    const installed: InstalledZolt = {
        binary: '/verified/zolt',
        cleanup: async () => { cleanups.push('install'); },
        sha256: 'b'.repeat(64),
        target: 'linux-x64',
        version: '0.1.0-test',
    };
    const zoltEnvironment: ZoltEnvironment = {
        cleanup: async () => { cleanups.push('environment'); },
        environment: { ZOLT_USER_HOME: '/private/home' },
    };

    await runAction({
        architecture: 'x64',
        capture: async () => outdatedReport(),
        core,
        createEnvironment: async () => zoltEnvironment,
        createRepository: async () => ({
            ...repository,
            cleanup: async () => { cleanups.push('repository'); },
            verify: async () => { verified = true; },
        }),
        environment: {},
        install: async () => installed,
        platform: 'linux',
        readContext: async () => execution,
        selectProject: async () => selection,
    });

    assert.deepEqual(core.failures, []);
    assert.equal(core.outputs.get('planned-update-count'), 1);
    assert.equal(core.outputs.get('created-pull-request-count'), 0);
    assert.match(core.summaries[0] ?? '', /Planning preview: no branches or pull requests were written/u);
    assert.equal(verified, true);
    assert.deepEqual(cleanups, ['environment', 'install', 'repository']);
});

test('runAction rejects write mode before repository or Zolt operations', async () => {
    const core = new FakeActionCore({ 'dry-run': 'false', 'github-token': 'github-token-value' });
    let created = false;
    await runAction({
        core,
        createRepository: async () => {
            created = true;
            return repository;
        },
        environment: {},
        readContext: async () => execution,
    });
    assert.equal(created, false);
    assert.match(core.failures[0] ?? '', /ZOLT-WRITE-001/u);
});

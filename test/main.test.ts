import * as assert from 'node:assert/strict';
import test from 'node:test';

import type { ExecutionContext } from '../src/environment/context.js';
import { renderPullRequestPreview } from '../src/github/preview.js';
import type { ManagedPublicationRepository } from '../src/github/publication.js';
import type { InstalledZolt } from '../src/install/install-zolt.js';
import { runAction } from '../src/main.js';
import type { ZoltProjectSelection } from '../src/types.js';
import type { ZoltEnvironment } from '../src/zolt/process.js';
import { outdatedReport, outdatedReportV2, repositoryView } from './support/fixtures.js';
import { FakeActionCore } from './support/core.js';

const execution: ExecutionContext = {
    defaultBranch: 'main',
    eventName: 'schedule',
    ref: 'refs/heads/main',
    repository: 'zoltsh/example',
    repositoryId: '123456',
    publicationGeneration: 'f'.repeat(64),
    sha: 'a'.repeat(40),
    workspace: '/checkout',
};
const repository = repositoryView();
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
        capture: async () => outdatedReportV2(),
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
    assert.match(String(core.outputs.get('plan')), /"authoritativeTarget":true/u);
    assert.match(core.summaries[0] ?? '', /Planning preview: no branches or pull requests were written/u);
    assert.equal(verified, true);
    assert.deepEqual(cleanups, ['environment', 'install', 'repository']);
});

test('runAction composes authoritative updates into managed publication', async () => {
    const core = new FakeActionCore({ 'dry-run': 'false', 'github-token': 'github-token-value' });
    const cleanups: string[] = [];
    let publicationRepositoryCreated = false;
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
        capture: async () => outdatedReportV2(),
        core,
        createEnvironment: async () => zoltEnvironment,
        createPublicationRepository: (name, token) => {
            assert.equal(name, 'zoltsh/example');
            assert.equal(token, 'github-token-value');
            publicationRepositoryCreated = true;
            return unusedPublicationRepository();
        },
        createRepository: async () => ({
            ...repository,
            cleanup: async () => { cleanups.push('repository'); },
            verify: async () => { verified = true; },
        }),
        environment: {},
        install: async () => installed,
        platform: 'linux',
        publish: async (input) => {
            const target = input.targets[0];
            assert.ok(target);
            assert.equal(input.targets.length, 1);
            assert.equal(input.baseSha, execution.sha);
            assert.equal(input.branchGeneration, execution.publicationGeneration);
            assert.equal(input.repositoryId, execution.repositoryId);
            assert.deepEqual(input.retained, []);
            const desired = {
                preview: renderPullRequestPreview(target, execution.publicationGeneration),
                target,
            };
            return {
                reconciliation: {
                    blocked: [],
                    close: [],
                    create: [desired],
                    deferred: [],
                    ignored: [],
                    refresh: [],
                    unchanged: [],
                },
                visibleWrites: [
                    { branch: desired.preview.branch, kind: 'branch-created', sha: 'c'.repeat(40) },
                    { branch: desired.preview.branch, kind: 'pull-request-created', number: 17 },
                ],
            };
        },
        readContext: async () => execution,
        selectProject: async () => selection,
    });

    assert.deepEqual(core.failures, []);
    assert.equal(publicationRepositoryCreated, true);
    assert.equal(core.outputs.get('planned-update-count'), 1);
    assert.equal(core.outputs.get('created-pull-request-count'), 1);
    assert.equal(core.outputs.get('updated-pull-request-count'), 0);
    assert.equal(core.outputs.get('closed-pull-request-count'), 0);
    assert.match(core.summaries[0] ?? '', /Managed publication complete: 1 created/u);
    assert.equal(verified, true);
    assert.deepEqual(cleanups, ['environment', 'install', 'repository']);
});

test('runAction refuses non-authoritative write mode after safe analysis', async () => {
    const core = new FakeActionCore({ 'dry-run': 'false', 'github-token': 'github-token-value' });
    let publicationRepositoryCreated = false;
    await runAction({
        architecture: 'x64',
        capture: async () => outdatedReport(),
        core,
        createEnvironment: async () => ({ cleanup: async () => undefined, environment: {} }),
        createPublicationRepository: () => {
            publicationRepositoryCreated = true;
            return unusedPublicationRepository();
        },
        createRepository: async () => repository,
        environment: {},
        install: async () => ({
            binary: '/verified/zolt',
            cleanup: async () => undefined,
            sha256: 'b'.repeat(64),
            target: 'linux-x64',
            version: '0.1.0-test',
        }),
        platform: 'linux',
        readContext: async () => execution,
        selectProject: async () => selection,
    });

    assert.equal(publicationRepositoryCreated, false);
    assert.match(core.failures[0] ?? '', /ZOLT-WRITE-001/u);
});

function unusedPublicationRepository(): ManagedPublicationRepository {
    return {
        closePullRequest: async () => undefined,
        createGeneratedBranch: async () => undefined,
        createManagedCommit: async () => 'c'.repeat(40),
        createPullRequest: async () => 1,
        fastForwardGeneratedBranch: async () => undefined,
        getDefaultBranchHead: async () => execution.sha,
        getGeneratedBranchHead: async () => null,
        listOpenPullRequests: async () => [],
        updatePullRequest: async () => undefined,
    };
}

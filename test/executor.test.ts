import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
    chmod,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { promisify } from 'node:util';

import { createRepositoryView } from '../src/environment/repository-state.js';
import { planUpdates } from '../src/planner/plan.js';
import { prepareExactUpdateArtifact } from '../src/update/executor.js';
import type { RepositoryView, ZoltProjectSelection } from '../src/types.js';
import {
    actionInputs,
    outdatedEntryV2,
    outdatedReport,
    outdatedReportV2,
    outdatedScopeV2,
    projectSelection,
    targetIdFor,
} from './support/fixtures.js';

const execute = promisify(execFile);

interface Fixture {
    readonly binary: string;
    readonly environment: NodeJS.ProcessEnv;
    readonly repository: RepositoryView;
    readonly root: string;
    readonly selection: ZoltProjectSelection;
    readonly target: ReturnType<typeof planUpdates>['selected'][number];
}

test('prepareExactUpdateArtifact creates a verified standalone manifest and lock artifact', async (context) => {
    const fixture = await exactFixture(context, false);
    const artifact = await prepareExactUpdateArtifact({
        binary: fixture.binary,
        environment: fixture.environment,
        includePrereleases: false,
        repository: fixture.repository,
        selection: fixture.selection,
        target: fixture.target,
    });

    assert.deepEqual(artifact.changedFiles, ['zolt.toml', 'zolt.lock']);
    assert.deepEqual(artifact.files.map((file) => file.path), ['zolt.toml', 'zolt.lock']);
    assert.match(artifact.files[0]?.content.toString('utf8') ?? '', /1\.1\.0/u);
    assert.match(artifact.files[1]?.content.toString('utf8') ?? '', /1\.1\.0/u);
    assert.equal(artifact.result.resolved, true);
    await fixture.repository.verify();
});

test('prepareExactUpdateArtifact routes a workspace target and verifies with --workspace', async (context) => {
    const fixture = await exactFixture(context, true);
    const log = join(fixture.root, 'fake-zolt-log.json');
    const artifact = await prepareExactUpdateArtifact({
        binary: fixture.binary,
        environment: { ...fixture.environment, FAKE_ZOLT_LOG: log },
        includePrereleases: false,
        repository: fixture.repository,
        selection: fixture.selection,
        target: fixture.target,
    });

    assert.deepEqual(artifact.changedFiles, ['apps/api/zolt.toml', 'zolt.lock']);
    const invocations = JSON.parse(await readFile(log, 'utf8')) as string[][];
    assert.equal(invocations.length, 2);
    assert.ok(invocations[0]?.includes('--target-id'));
    assert.ok(invocations[1]?.includes('--workspace'));
    assert.ok(invocations[1]?.includes('--offline'));
});

test('prepareExactUpdateArtifact uses the authoritative schema-v2 verification mode', async (context) => {
    const fixture = await exactFixture(context, false);
    let observedMode: 'project' | 'workspace' | undefined;
    await prepareExactUpdateArtifact({
        binary: fixture.binary,
        environment: fixture.environment,
        includePrereleases: false,
        repository: fixture.repository,
        selection: { ...fixture.selection, mode: 'workspace' },
        target: fixture.target,
    }, {
        verify: async (_binary, mode) => {
            observedMode = mode.mode;
        },
    });

    assert.equal(observedMode, 'project');
});

test('prepareExactUpdateArtifact rejects unreported and out-of-bound file changes', async (context) => {
    const extra = await exactFixture(context, false, 'extra-file');
    await assert.rejects(
        prepareExactUpdateArtifact({
            binary: extra.binary,
            environment: extra.environment,
            includePrereleases: false,
            repository: extra.repository,
            selection: extra.selection,
            target: extra.target,
        }),
        /outside its manifest\/root-lock boundary/u,
    );

    const misreported = await exactFixture(context, false, 'misreport');
    await assert.rejects(
        prepareExactUpdateArtifact({
            binary: misreported.binary,
            environment: misreported.environment,
            includePrereleases: false,
            repository: misreported.repository,
            selection: misreported.selection,
            target: misreported.target,
        }),
        /did not exactly match/u,
    );
});

test('prepareExactUpdateArtifact rejects a locked verification that mutates the artifact', async (context) => {
    const fixture = await exactFixture(context, false, 'verify-mutates');
    await assert.rejects(
        prepareExactUpdateArtifact({
            binary: fixture.binary,
            environment: fixture.environment,
            includePrereleases: false,
            repository: fixture.repository,
            selection: fixture.selection,
            target: fixture.target,
        }),
        /verification changed/u,
    );
});



test('prepareExactUpdateArtifact rejects mode changes and inconsistent selected roots', async (context) => {
    const modeChange = await exactFixture(context, false, 'mode-change');
    await assert.rejects(
        prepareExactUpdateArtifact({
            binary: modeChange.binary,
            environment: modeChange.environment,
            includePrereleases: false,
            repository: modeChange.repository,
            selection: modeChange.selection,
            target: modeChange.target,
        }),
        /changed file modes/u,
    );

    let copied = false;
    const inconsistent: RepositoryView = {
        ...modeChange.repository,
        createMutableCopy: async () => {
            copied = true;
            return modeChange.repository.createMutableCopy();
        },
    };
    await assert.rejects(
        prepareExactUpdateArtifact({
            binary: modeChange.binary,
            environment: modeChange.environment,
            includePrereleases: false,
            repository: inconsistent,
            selection: { ...modeChange.selection, relativeRoot: 'other' },
            target: modeChange.target,
        }),
        /does not belong to the selected Zolt mutation root/u,
    );
    assert.equal(copied, false);
});

test('prepareExactUpdateArtifact ignores transient empty directories that Git cannot publish', async (context) => {
    const fixture = await exactFixture(context, false, 'empty-directory');
    const artifact = await prepareExactUpdateArtifact({
        binary: fixture.binary,
        environment: fixture.environment,
        includePrereleases: false,
        repository: fixture.repository,
        selection: fixture.selection,
        target: fixture.target,
    });

    assert.deepEqual(artifact.changedFiles, ['zolt.toml', 'zolt.lock']);
});

test('prepareExactUpdateArtifact re-verifies the immutable view after an execution failure', async () => {
    const selection = projectSelection();
    const target = planUpdates(
        outdatedReportV2(),
        selection,
        actionInputs(),
    ).selected[0];
    assert.ok(target);
    let verifications = 0;
    let cleaned = false;
    const repository: RepositoryView = {
        cleanup: async () => undefined,
        createMutableCopy: async () => ({
            cleanup: async () => { cleaned = true; },
            directory: '/private/mutable',
            directoryInput: '.',
            inspectChanges: async () => { throw new Error('not reached'); },
            workspace: '/private/mutable',
        }),
        directory: '/private/repository',
        directoryInput: '.',
        verify: async () => { verifications += 1; },
        workspace: '/private/repository',
    };

    await assert.rejects(
        prepareExactUpdateArtifact({
            binary: '/verified/zolt',
            environment: {},
            includePrereleases: false,
            repository,
            selection,
            target,
        }, {
            exactUpdate: async () => { throw new Error('exact update failed'); },
        }),
        /exact update failed/u,
    );
    assert.equal(cleaned, true);
    assert.equal(verifications, 2);
});

test('prepareExactUpdateArtifact refuses a provisional schema-v1 target before copying', async () => {
    let copied = false;
    const repository: RepositoryView = {
        cleanup: async () => undefined,
        createMutableCopy: async () => {
            copied = true;
            throw new Error('not reached');
        },
        directory: '/private/repository',
        directoryInput: '.',
        verify: async () => undefined,
        workspace: '/private/repository',
    };
    const target = planUpdates(outdatedReport(), projectSelection(), actionInputs()).selected[0];
    assert.ok(target);

    await assert.rejects(
        prepareExactUpdateArtifact({
            binary: '/verified/zolt',
            environment: {},
            includePrereleases: false,
            repository,
            selection: projectSelection(),
            target,
        }),
        /authoritative schema-v2/u,
    );
    assert.equal(copied, false);
});

async function exactFixture(
    context: TestContext,
    workspace: boolean,
    mode = 'normal',
): Promise<Fixture> {
    const root = await mkdtemp(join(tmpdir(), 'zolt-exact-action-test-'));
    const runnerTemp = await mkdtemp(join(tmpdir(), 'zolt-exact-action-private-'));
    context.after(async () => Promise.all([
        rm(root, { force: true, recursive: true }),
        rm(runnerTemp, { force: true, recursive: true }),
    ]).then(() => undefined));
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    const manifestPath = workspace ? 'apps/api/zolt.toml' : 'zolt.toml';
    if (workspace) {
        await mkdir(join(root, 'apps', 'api'), { recursive: true });
        await writeFile(join(root, 'zolt.toml'), '[workspace]\nmembers = ["apps/api"]\n', 'utf8');
    }
    await writeFile(
        join(root, ...manifestPath.split('/')),
        '[project]\nname = "demo"\nversion = "1.0.0"\n',
        'utf8',
    );
    await writeFile(join(root, 'zolt.lock'), 'dependency = "com.example:demo:1.0.0"\n', 'utf8');
    const binary = join(root, 'fake-zolt.cjs');
    await writeFile(binary, fakeZoltSource(), { encoding: 'utf8', mode: 0o755 });
    await chmod(binary, 0o755);
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'fixture']);
    const sha = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const repository = await createRepositoryView({ directory: '.', expectedSha: sha, workspace: root }, {
        environment: { RUNNER_TEMP: runnerTemp },
    });
    const selection = projectSelection({
        lockfilePath: 'zolt.lock',
        manifestPath: 'zolt.toml',
        mode: workspace ? 'workspace' : 'project',
        root: repository.workspace,
    });
    const report = outdatedReportV2([outdatedScopeV2(
        workspace ? 'apps/api' : 'demo',
        [outdatedEntryV2({}, manifestPath)],
        { manifestPath },
    )]);
    const target = planUpdates(report, selection, actionInputs()).selected[0];
    assert.ok(target);
    return {
        binary,
        environment: {
            ...process.env,
            FAKE_ZOLT_FROM: '1.0.0',
            FAKE_ZOLT_IDENTIFIER: 'com.example:demo',
            FAKE_ZOLT_LOCK: 'zolt.lock',
            FAKE_ZOLT_MANIFEST: manifestPath,
            FAKE_ZOLT_MODE: mode,
            FAKE_ZOLT_SECTION: '[dependencies]',
            FAKE_ZOLT_SURFACE: 'dependency',
            FAKE_ZOLT_TARGET_ID: targetIdFor({ manifestPath }),
            FAKE_ZOLT_TO: '1.1.0',
        },
        repository,
        root,
        selection,
        target,
    };
}

async function git(cwd: string, arguments_: readonly string[]): Promise<string> {
    const result = await execute('git', arguments_, { cwd, encoding: 'utf8' });
    return result.stdout;
}

function fakeZoltSource(): string {
    return `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const log = process.env.FAKE_ZOLT_LOG;
if (log) {
  const previous = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : [];
  previous.push(args);
  fs.writeFileSync(log, JSON.stringify(previous));
}
if (args.includes('update')) {
  const manifest = path.join(process.cwd(), process.env.FAKE_ZOLT_MANIFEST);
  const lock = path.join(process.cwd(), process.env.FAKE_ZOLT_LOCK);
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replaceAll(process.env.FAKE_ZOLT_FROM, process.env.FAKE_ZOLT_TO));
  fs.writeFileSync(lock, 'dependency = "' + process.env.FAKE_ZOLT_IDENTIFIER + ':' + process.env.FAKE_ZOLT_TO + '"\\n');
  if (process.env.FAKE_ZOLT_MODE === 'extra-file') fs.writeFileSync(path.join(process.cwd(), 'unexpected.txt'), 'unexpected\\n');
  if (process.env.FAKE_ZOLT_MODE === 'mode-change') fs.chmodSync(manifest, 0o755);
  if (process.env.FAKE_ZOLT_MODE === 'empty-directory') fs.mkdirSync(path.join(process.cwd(), '.zolt', 'locks'), { recursive: true });
  const changedFiles = process.env.FAKE_ZOLT_MODE === 'misreport'
    ? [process.env.FAKE_ZOLT_MANIFEST]
    : [process.env.FAKE_ZOLT_MANIFEST, process.env.FAKE_ZOLT_LOCK];
  process.stdout.write(JSON.stringify({
    applied: true,
    changed: true,
    changedFiles,
    class: 'minor',
    command: 'update',
    diagnostics: [],
    dryRun: false,
    fanOut: [],
    from: process.env.FAKE_ZOLT_FROM,
    resolved: true,
    schemaVersion: 2,
    status: 'ok',
    target: {
      identifier: process.env.FAKE_ZOLT_IDENTIFIER,
      lockfilePath: process.env.FAKE_ZOLT_LOCK,
      manifestPath: process.env.FAKE_ZOLT_MANIFEST,
      section: process.env.FAKE_ZOLT_SECTION,
      surface: process.env.FAKE_ZOLT_SURFACE,
      targetId: process.env.FAKE_ZOLT_TARGET_ID,
      updateable: true
    },
    to: process.env.FAKE_ZOLT_TO
  }));
  process.exit(0);
}
if (args.includes('resolve')) {
  if (process.env.FAKE_ZOLT_MODE === 'verify-mutates') {
    const lock = path.join(process.cwd(), process.env.FAKE_ZOLT_LOCK);
    fs.appendFileSync(lock, 'verification = "mutated"\\n');
  }
  process.stdout.write('locked\\n');
  process.exit(0);
}
process.exit(2);
`;
}

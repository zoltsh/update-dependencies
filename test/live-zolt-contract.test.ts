import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { promisify } from 'node:util';

import { ZOLT_EXACT_TARGET_CONTRACT_COMMIT } from '../src/generated/zolt-source-contract.js';
import { decodeOutdatedReportV2 } from '../src/zolt/contracts-v2.js';
import { decodeExactUpdateResult } from '../src/zolt/exact-contract.js';
import { decodeMachineFailure } from '../src/zolt/failure-contract.js';
import { createZoltTargetId } from '../src/zolt/target-id.js';

const execute = promisify(execFile);
const binary = process.env.ZOLT_LIVE_BINARY;
const live = binary === undefined ? test.skip : test;

live('live contract canary uses the reviewed Zolt source commit', () => {
    assert.equal(process.env.ZOLT_LIVE_SOURCE_COMMIT, ZOLT_EXACT_TARGET_CONTRACT_COMMIT);
});

live('current Zolt source satisfies standalone exact-target schema v2', async (context) => {
    const root = await project(context, 'standalone');
    const report = await outdated(root);
    const scope = report.scopes[0];
    const entry = scope?.entries[0];
    assert.ok(scope);
    assert.ok(entry);
    assert.equal(scope.manifestPath, 'zolt.toml');
    assert.equal(entry.targetId, createZoltTargetId({
        identifier: 'com.example:lib',
        manifestPath: 'zolt.toml',
        section: '[dependencies]',
        surface: 'dependency',
    }));

    const result = await exact(root, entry.targetId, '1.1.0');
    assert.equal(result.applied, true);
    assert.equal(result.resolved, false);
    assert.deepEqual(result.changedFiles, ['zolt.toml']);
    assert.match(await readFile(join(root, 'zolt.toml'), 'utf8'), /"1\.1\.0"/u);
});

live('current Zolt source routes workspace targets and preserves root-relative paths', async (context) => {
    const root = await temporaryRoot(context, 'workspace');
    const member = join(root, 'apps', 'api');
    await mkdir(member, { recursive: true });
    await writeFile(join(root, 'zolt.toml'), `
[workspace]
name = "platform"
members = ["apps/api"]
`, 'utf8');
    await writeProject(join(member, 'zolt.toml'));

    const report = await outdated(root);
    const scope = report.scopes[0];
    const entry = scope?.entries[0];
    assert.equal(scope?.label, 'apps/api');
    assert.equal(scope?.manifestPath, 'apps/api/zolt.toml');
    assert.equal(scope?.lockfilePath, 'zolt.lock');
    assert.ok(entry);

    const result = await exact(root, entry.targetId, '1.1.0');
    assert.deepEqual(result.changedFiles, ['apps/api/zolt.toml']);
    assert.match(await readFile(join(member, 'zolt.toml'), 'utf8'), /"1\.1\.0"/u);
});

live('current Zolt source treats a retained empty workspace domain as standalone', async (context) => {
    const root = await project(context, 'retained-empty');
    await writeFile(join(root, 'zolt.toml'), `${await readFile(join(root, 'zolt.toml'), 'utf8')}
[workspace]
name = "retained"
members = []
`, 'utf8');

    const report = await outdated(root);
    assert.equal(report.scopes.length, 1);
    assert.equal(report.scopes[0]?.label, basename(root));
    assert.equal(report.scopes[0]?.manifestPath, 'zolt.toml');
});

live('current Zolt source emits selected-schema failures on stdout', async (context) => {
    const root = await project(context, 'failure');
    const result = await invoke([
        'update',
        '--target-id',
        `zt1_${'A'.repeat(43)}`,
        '--to',
        '1.1.0',
        '--format',
        'json',
        '--schema-version',
        '2',
        '--no-resolve',
        '--cwd',
        root,
    ], true);
    assert.equal(result.stderr, '');
    const failure = decodeMachineFailure(result.stdout, 'update', 2);
    assert.equal(failure.diagnostics[0]?.severity, 'error');
});

async function outdated(root: string) {
    const result = await invoke([
        'outdated',
        '--format',
        'json',
        '--schema-version',
        '2',
        '--all',
        '--offline',
        '--cwd',
        root,
    ]);
    assert.equal(result.stderr, '');
    return decodeOutdatedReportV2(result.stdout);
}

async function exact(root: string, targetId: string, to: string) {
    const result = await invoke([
        'update',
        '--target-id',
        targetId,
        '--to',
        to,
        '--format',
        'json',
        '--schema-version',
        '2',
        '--no-resolve',
        '--cwd',
        root,
    ]);
    assert.equal(result.stderr, '');
    return decodeExactUpdateResult(result.stdout);
}

async function invoke(arguments_: readonly string[], expectFailure = false) {
    assert.ok(binary);
    try {
        const result = await execute(binary, ['--color', 'never', '--progress', 'never', ...arguments_], {
            encoding: 'utf8',
            env: { ...process.env, NO_COLOR: '1' },
            maxBuffer: 64 * 1024 * 1024,
            timeout: 120_000,
        });
        if (expectFailure) assert.fail('Expected the live Zolt command to fail.');
        return result;
    } catch (error) {
        if (!expectFailure) throw error;
        const failure = error as { readonly stderr?: string; readonly stdout?: string };
        return { stderr: failure.stderr ?? '', stdout: failure.stdout ?? '' };
    }
}

async function project(context: TestContext, name: string): Promise<string> {
    const root = await temporaryRoot(context, name);
    await writeProject(join(root, 'zolt.toml'));
    return root;
}

async function temporaryRoot(context: TestContext, name: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), `zolt-live-${name}-`));
    context.after(async () => rm(root, { force: true, recursive: true }));
    return root;
}

async function writeProject(path: string): Promise<void> {
    await writeFile(path, `
[project]
name = "demo"
version = "0.1.0"
group = "com.example"
java = "21"

[repositories]
central = "https://repo.maven.apache.org/maven2"

[dependencies]
"com.example:lib" = "1.0.0"
`, 'utf8');
}

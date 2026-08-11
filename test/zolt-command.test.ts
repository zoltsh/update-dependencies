import * as assert from 'node:assert/strict';
import test from 'node:test';

import { captureOutdated, runExactUpdate, verifyLockedOffline } from '../src/zolt/commands.js';
import { runZolt } from '../src/zolt/process.js';
import {
    actionInputs,
    outdatedReportV2,
    projectSelection,
    TEST_TARGET_ID,
} from './support/fixtures.js';

const document = JSON.stringify({
    command: 'outdated',
    diagnostics: [],
    notes: [],
    schemaVersion: 1,
    scopes: [],
    status: 'ok',
});

test('captureOutdated invokes the verified binary with machine flags and selectors', async () => {
    let observed: readonly string[] = [];
    const report = await captureOutdated(
        '/verified/zolt',
        actionInputs({ includePrereleases: true, selectors: ['com.example:demo', 'versions'] }),
        projectSelection(),
        { PATH: '/usr/bin' },
        {
            run: async (_binary, arguments_) => {
                observed = arguments_;
                return { stderr: '', stdout: document };
            },
        },
    );

    assert.deepEqual(observed, [
        '--color',
        'never',
        '--progress',
        'never',
        'outdated',
        '--format',
        'json',
        '--include-prereleases',
        'com.example:demo',
        'versions',
    ]);
    assert.equal(report.schemaVersion, 1);
});

test('captureOutdated rejects unexpected stderr in machine mode', async () => {
    await assert.rejects(
        captureOutdated('/verified/zolt', actionInputs(), projectSelection(), {}, {
            run: async () => ({ stderr: 'warning', stdout: document }),
        }),
        /unexpected diagnostic output/u,
    );
});

test('runZolt rejects invalid UTF-8 as a normal promise failure', async () => {
    await assert.rejects(
        runZolt(
            process.execPath,
            ['-e', 'process.stdout.write(Buffer.from([0xff]))'],
            process.cwd(),
            process.env,
            10_000,
        ),
        /not valid UTF-8/u,
    );
});


test('captureOutdated opts into schema v2 only for a release that declares support', async () => {
    let observed: readonly string[] = [];
    const expected = outdatedReportV2();
    const report = await captureOutdated(
        '/verified/zolt',
        actionInputs(),
        projectSelection(),
        {},
        {
            decodeV2: () => expected,
            run: async (_binary, arguments_) => {
                observed = arguments_;
                return { stderr: '', stdout: '{}' };
            },
            schemaVersion: 2,
        },
    );

    assert.deepEqual(observed, [
        '--color',
        'never',
        '--progress',
        'never',
        'outdated',
        '--format',
        'json',
        '--schema-version',
        '2',
    ]);
    assert.equal(report, expected);
});

test('runExactUpdate invokes one authoritative target and exact destination', async () => {
    let observed: readonly string[] = [];
    const expected = {
        applied: true,
        changed: true,
        changedFiles: ['zolt.toml', 'zolt.lock'],
        changeClass: 'minor',
        command: 'update',
        diagnostics: [],
        dryRun: false,
        fanOut: [],
        from: '1.0.0',
        resolved: true,
        schemaVersion: 2,
        status: 'ok',
        target: {
            identifier: 'com.example:demo',
            lockfilePath: 'zolt.lock',
            manifestPath: 'zolt.toml',
            section: '[dependencies]',
            surface: 'dependency',
            targetId: TEST_TARGET_ID,
            updateable: true,
        },
        to: '1.1.0',
    } as const;
    const result = await runExactUpdate('/verified/zolt', '/private/repository', {}, {
        includePrereleases: true,
        targetId: TEST_TARGET_ID,
        toVersion: '1.1.0',
    }, {
        decode: () => expected,
        run: async (_binary, arguments_) => {
            observed = arguments_;
            return { stderr: '', stdout: '{}' };
        },
    });

    assert.deepEqual(observed, [
        '--color',
        'never',
        '--progress',
        'never',
        'update',
        '--target-id',
        TEST_TARGET_ID,
        '--to',
        '1.1.0',
        '--format',
        'json',
        '--schema-version',
        '2',
        '--include-prereleases',
    ]);
    assert.equal(result, expected);
});

test('verifyLockedOffline adds workspace routing without another metadata operation', async () => {
    const observed: string[][] = [];
    const run = async (_binary: string, arguments_: readonly string[]) => {
        observed.push([...arguments_]);
        return { stderr: '', stdout: 'locked\n' };
    };
    await verifyLockedOffline('/verified/zolt', { mode: 'project' }, '/project', {}, { run });
    await verifyLockedOffline('/verified/zolt', { mode: 'workspace' }, '/workspace', {}, { run });

    assert.deepEqual(observed, [
        ['--color', 'never', '--progress', 'never', 'resolve', '--locked', '--offline'],
        ['--color', 'never', '--progress', 'never', 'resolve', '--workspace', '--locked', '--offline'],
    ]);
});

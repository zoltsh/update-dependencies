import * as assert from 'node:assert/strict';
import test from 'node:test';

import { captureOutdated } from '../src/zolt/commands.js';
import { runZolt } from '../src/zolt/process.js';
import { actionInputs, projectSelection } from './support/fixtures.js';

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

import { resolve } from 'node:path';

import { ZOLT_SOURCE_COMMIT } from '../dist/generated/zolt-release.js';
import { installZolt } from '../dist/install/install-zolt.js';
import { resolveTarget } from '../dist/install/platform.js';
import { run } from './tooling.mjs';

const root = resolve(import.meta.dirname, '..');
const expected = process.env.EXPECTED_ZOLT_TARGET;
if (expected === undefined || expected === '') {
    throw new Error('EXPECTED_ZOLT_TARGET is not set.');
}
const actual = resolveTarget(process.platform, process.arch);
if (actual !== expected) {
    throw new Error(`Runner target mismatch: expected ${expected}; actual ${actual}.`);
}

const installed = await installZolt(actual);
try {
    console.log(`Verified Zolt ${installed.version} for ${installed.target}.`);
    await run(
        process.execPath,
        [
            '--test',
            '--test-reporter',
            'spec',
            resolve(root, 'dist-test/test/live-zolt-contract.test.js'),
        ],
        {
            cwd: root,
            env: {
                ...process.env,
                ZOLT_LIVE_BINARY: installed.binary,
                ZOLT_LIVE_SOURCE_COMMIT: ZOLT_SOURCE_COMMIT,
            },
        },
    );
} finally {
    await installed.cleanup();
}

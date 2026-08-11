import * as assert from 'node:assert/strict';
import test from 'node:test';

import { execText } from '../src/process.js';

test('execText drains child output before resolving', async () => {
    const bytes = 4 * 1024 * 1024;
    const result = await execText(
        process.execPath,
        ['-e', `process.stdout.write('x'.repeat(${bytes.toString()}));`],
        { label: 'output drain test', maxBuffer: bytes + 1 },
    );

    assert.equal(result.stderr, '');
    assert.equal(result.stdout.length, bytes);
    assert.equal(result.stdout[0], 'x');
    assert.equal(result.stdout.at(-1), 'x');
});

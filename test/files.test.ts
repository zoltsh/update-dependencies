import * as assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BoundedFileError, readBoundedRegularFile } from '../src/files.js';

test('readBoundedRegularFile reads one opened regular-file snapshot', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'zolt-bounded-file-test-'));
    context.after(async () => rm(root, { force: true, recursive: true }));
    const path = join(root, 'value');
    await writeFile(path, 'verified\n', 'utf8');
    await chmod(path, 0o755);

    const file = await readBoundedRegularFile(path, 32);

    assert.equal(file.content.toString('utf8'), 'verified\n');
    assert.notEqual(file.mode & 0o111, 0);
});

test('readBoundedRegularFile rejects links and excessive content', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'zolt-bounded-file-test-'));
    context.after(async () => rm(root, { force: true, recursive: true }));
    const target = join(root, 'target');
    const link = join(root, 'link');
    await writeFile(target, '12345', 'utf8');
    await symlink(target, link);

    await assert.rejects(readBoundedRegularFile(link, 32));
    await assert.rejects(
        readBoundedRegularFile(target, 4),
        (error: unknown) => error instanceof BoundedFileError && error.failure === 'too-large',
    );
});

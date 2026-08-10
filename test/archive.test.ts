import * as assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { extractArchive, inspectArchive } from '../src/install/archive.js';
import { tarGz } from './support/tar.js';

test('archive inspection and extraction accept one contained Zolt executable', async (context) => {
    const temporary = await mkdtemp(join(tmpdir(), 'zolt-archive-test-'));
    context.after(async () => rm(temporary, { force: true, recursive: true }));
    const root = 'zolt-test-linux-x64';
    const archive = join(temporary, 'zolt.tar.gz');
    await writeFile(archive, tarGz([
        { path: `${root}/`, type: 'directory' },
        { path: `${root}/bin/`, type: 'directory' },
        { content: Buffer.from('#!/bin/sh\n'), mode: 0o755, path: `${root}/bin/zolt` },
        { content: Buffer.from('license\n'), path: `${root}/LICENSE` },
    ]));

    await inspectArchive(archive, root);
    const binary = await extractArchive(archive, join(temporary, 'extract'), root);
    assert.equal(await readFile(binary, 'utf8'), '#!/bin/sh\n');
    await access(join(temporary, 'extract', root, 'LICENSE'));
});

test('archive inspection rejects traversal and link entries', async (context) => {
    const temporary = await mkdtemp(join(tmpdir(), 'zolt-archive-test-'));
    context.after(async () => rm(temporary, { force: true, recursive: true }));
    const root = 'zolt-test-linux-x64';
    const traversal = join(temporary, 'traversal.tar.gz');
    await writeFile(traversal, tarGz([
        { content: Buffer.from('bad'), path: `${root}/../escape` },
        { content: Buffer.from('zolt'), mode: 0o755, path: `${root}/bin/zolt` },
    ]));
    await assert.rejects(inspectArchive(traversal, root), /unsafe path/u);

    const link = join(temporary, 'link.tar.gz');
    await writeFile(link, tarGz([
        { path: `${root}/alias`, type: 'symlink' },
        { content: Buffer.from('zolt'), mode: 0o755, path: `${root}/bin/zolt` },
    ]));
    await assert.rejects(inspectArchive(link, root), /forbidden type/u);
});

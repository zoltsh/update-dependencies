import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { downloadArchive } from '../src/install/download.js';

test('downloadArchive saves and hashes one bounded HTTPS response', async (context) => {
    const temporary = await mkdtemp(join(tmpdir(), 'zolt-download-test-'));
    context.after(async () => rm(temporary, { force: true, recursive: true }));
    const destination = join(temporary, 'archive.tar.gz');
    const content = Buffer.from('archive bytes');
    const fetcher: typeof fetch = async () => new Response(content, {
        headers: {
            'content-encoding': 'identity',
            'content-length': content.length.toString(),
        },
        status: 200,
    });

    const result = await downloadArchive(
        new URL('https://github.com/zoltsh/releases/releases/download/test/archive.tar.gz'),
        destination,
        fetcher,
    );

    assert.equal(result.bytes, content.length);
    assert.equal(result.sha256, createHash('sha256').update(content).digest('hex'));
    assert.deepEqual(await readFile(destination), content);
});

test('downloadArchive rejects non-GitHub origins before making a request', async () => {
    let called = false;
    const fetcher: typeof fetch = async () => {
        called = true;
        return new Response('no');
    };

    await assert.rejects(
        downloadArchive(new URL('https://example.com/archive.tar.gz'), '/tmp/unused', fetcher),
        /not an expected GitHub HTTPS URL/u,
    );
    assert.equal(called, false);
});

test('downloadArchive rejects an encoded response', async (context) => {
    const temporary = await mkdtemp(join(tmpdir(), 'zolt-download-test-'));
    context.after(async () => rm(temporary, { force: true, recursive: true }));
    const fetcher: typeof fetch = async () => new Response('compressed', {
        headers: { 'content-encoding': 'gzip' },
        status: 200,
    });

    await assert.rejects(
        downloadArchive(
            new URL('https://github.com/zoltsh/releases/releases/download/test/archive.tar.gz'),
            join(temporary, 'archive'),
            fetcher,
        ),
        /unexpected content encoding/u,
    );
});

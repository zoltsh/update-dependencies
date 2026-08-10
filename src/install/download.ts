import { createHash } from 'node:crypto';
import { open, rm, type FileHandle } from 'node:fs/promises';

import { MAX_ARCHIVE_BYTES } from '../constants.js';
import { actionError, UpdateDependenciesError } from '../errors.js';

export interface DownloadResult {
    readonly bytes: number;
    readonly sha256: string;
}

export type Fetch = typeof fetch;

export async function downloadArchive(
    url: URL,
    destination: string,
    fetcher: Fetch = fetch,
): Promise<DownloadResult> {
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
        throw actionError('ZOLT-INSTALL-003', 'The embedded Zolt archive URL is not an expected GitHub HTTPS URL.');
    }
    let response: Response;
    try {
        response = await fetcher(url, {
            headers: {
                accept: 'application/octet-stream',
                'accept-encoding': 'identity',
                'user-agent': 'zoltsh/update-dependencies',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(120_000),
        });
    } catch (error) {
        throw actionError('ZOLT-INSTALL-004', 'Could not download the pinned Zolt archive.', error);
    }
    if (!response.ok || response.body === null) {
        throw actionError('ZOLT-INSTALL-004', `Could not download the pinned Zolt archive: HTTP ${response.status.toString()}.`);
    }
    if (response.url !== '') {
        const finalUrl = new URL(response.url);
        if (finalUrl.protocol !== 'https:' || !allowedReleaseHost(finalUrl.hostname)) {
            throw actionError('ZOLT-INSTALL-004', 'The Zolt archive download redirected to an untrusted host.');
        }
    }
    const contentEncoding = response.headers.get('content-encoding');
    if (contentEncoding !== null && contentEncoding !== '' && contentEncoding.toLowerCase() !== 'identity') {
        throw actionError('ZOLT-INSTALL-004', 'The Zolt archive response used an unexpected content encoding.');
    }
    const length = response.headers.get('content-length');
    if (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) > MAX_ARCHIVE_BYTES)) {
        throw actionError('ZOLT-INSTALL-005', 'The pinned Zolt archive exceeds the download size limit.');
    }
    const file = await open(destination, 'wx', 0o600);
    const digest = createHash('sha256');
    let bytes = 0;
    try {
        const reader = response.body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = Buffer.from(value);
            bytes += chunk.length;
            if (bytes > MAX_ARCHIVE_BYTES) {
                await reader.cancel();
                throw actionError('ZOLT-INSTALL-005', 'The pinned Zolt archive exceeds the download size limit.');
            }
            digest.update(chunk);
            await writeAll(file, chunk);
        }
        await file.sync();
    } catch (error) {
        await rm(destination, { force: true });
        if (error instanceof UpdateDependenciesError) throw error;
        throw actionError('ZOLT-INSTALL-004', 'Could not save the pinned Zolt archive.', error);
    } finally {
        await file.close();
    }
    if (bytes === 0) {
        await rm(destination, { force: true });
        throw actionError('ZOLT-INSTALL-004', 'The pinned Zolt archive download was empty.');
    }
    return { bytes, sha256: digest.digest('hex') };
}

function allowedReleaseHost(hostname: string): boolean {
    return hostname === 'github.com' || hostname.endsWith('.githubusercontent.com');
}

async function writeAll(file: FileHandle, value: Buffer): Promise<void> {
    let offset = 0;
    while (offset < value.length) {
        const result = await file.write(value, offset, value.length - offset);
        if (result.bytesWritten <= 0) {
            throw actionError('ZOLT-INSTALL-004', 'Could not make progress while saving the pinned Zolt archive.');
        }
        offset += result.bytesWritten;
    }
}

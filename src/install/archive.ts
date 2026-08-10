import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, posix, resolve, sep } from 'node:path';
import { createGunzip } from 'node:zlib';

import {
    MAX_ARCHIVE_DECOMPRESSION_RATIO,
    MAX_ARCHIVE_ENTRIES,
    MAX_ARCHIVE_ENTRY_BYTES,
    MAX_EXTRACTED_BYTES,
} from '../constants.js';
import { actionError } from '../errors.js';

interface TarEntry {
    readonly content: Buffer;
    readonly mode: number;
    readonly path: string;
    readonly type: 'directory' | 'file';
}

export async function inspectArchive(archive: string, expectedRoot: string): Promise<void> {
    const compressed = (await stat(archive)).size;
    const tar = await gunzipBounded(archive);
    if (compressed === 0 || tar.length / compressed > MAX_ARCHIVE_DECOMPRESSION_RATIO) {
        throw archiveError('The Zolt archive exceeds the decompression ratio limit.');
    }
    parseTar(tar, expectedRoot);
}

export async function extractArchive(archive: string, destination: string, expectedRoot: string): Promise<string> {
    const compressed = (await stat(archive)).size;
    const tar = await gunzipBounded(archive);
    if (compressed === 0 || tar.length / compressed > MAX_ARCHIVE_DECOMPRESSION_RATIO) {
        throw archiveError('The Zolt archive exceeds the decompression ratio limit.');
    }
    const entries = parseTar(tar, expectedRoot);
    await mkdir(destination, { mode: 0o700, recursive: true });
    for (const entry of entries) {
        const path = resolve(destination, ...entry.path.split('/'));
        if (entry.type === 'directory') {
            await mkdir(path, { mode: 0o700, recursive: true });
            continue;
        }
        await mkdir(resolve(path, '..'), { mode: 0o700, recursive: true });
        await writeFile(path, entry.content, { flag: 'wx', mode: entry.path === `${expectedRoot}/bin/zolt` ? 0o755 : 0o644 });
    }
    const root = resolve(destination, expectedRoot);
    const binary = resolve(root, 'bin', 'zolt');
    const [rootReal, binaryReal, info] = await Promise.all([realpath(root), realpath(binary), lstat(binary)]);
    if (!binaryReal.startsWith(`${rootReal}${sep}`) || !info.isFile() || info.isSymbolicLink()) {
        throw archiveError('Extracted Zolt executable is not a contained regular file.');
    }
    await chmod(binary, 0o755);
    return binary;
}

async function gunzipBounded(archive: string): Promise<Buffer> {
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];
    let total = 0;
    const source = createReadStream(archive);
    source.pipe(gunzip);
    try {
        for await (const value of gunzip) {
            const chunk = Buffer.from(value);
            total += chunk.length;
            if (total > MAX_EXTRACTED_BYTES) {
                source.destroy();
                gunzip.destroy();
                throw archiveError('The Zolt archive exceeds the extracted size limit.');
            }
            chunks.push(chunk);
        }
    } catch (error) {
        if (error instanceof Error && error.name === 'UpdateDependenciesError') throw error;
        throw archiveError('Could not decompress the pinned Zolt archive.', error);
    }
    return Buffer.concat(chunks, total);
}

function parseTar(tar: Buffer, expectedRoot: string): readonly TarEntry[] {
    const entries: TarEntry[] = [];
    const paths = new Set<string>();
    let offset = 0;
    let foundBinary = false;
    let ended = false;
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        offset += 512;
        if (header.every((value) => value === 0)) {
            ended = true;
            break;
        }
        validateChecksum(header);
        const name = text(header.subarray(0, 100));
        const prefix = text(header.subarray(345, 500));
        const path = prefix === '' ? name : `${prefix}/${name}`;
        const mode = octal(header.subarray(100, 108), 'mode');
        const size = octal(header.subarray(124, 136), 'size');
        const typeFlag = header[156] ?? 0;
        const type = typeFlag === 0 || typeFlag === 48 ? 'file' : typeFlag === 53 ? 'directory' : undefined;
        if (type === undefined) throw archiveError(`Archive entry ${path} has a forbidden type.`);
        validatePath(path, expectedRoot);
        if (size > MAX_ARCHIVE_ENTRY_BYTES || type === 'directory' && size !== 0) {
            throw archiveError(`Archive entry ${path} is too large or malformed.`);
        }
        if ((mode & 0o7000) !== 0) throw archiveError(`Archive entry ${path} contains privilege bits.`);
        const key = path.replace(/\/$/u, '').toLowerCase();
        if (paths.has(key)) throw archiveError(`Archive contains a duplicate or case-colliding path: ${path}.`);
        paths.add(key);
        const end = offset + size;
        if (end > tar.length) throw archiveError('The Zolt archive is truncated.');
        const content = type === 'file' ? Buffer.from(tar.subarray(offset, end)) : Buffer.alloc(0);
        const expectedBinary = `${expectedRoot}/bin/zolt`;
        if (type === 'file' && (mode & 0o111) !== 0 && path !== expectedBinary) {
            throw archiveError(`Archive contains an unexpected executable: ${path}.`);
        }
        if (path === expectedBinary) {
            if (type !== 'file' || foundBinary) throw archiveError('Archive contains an invalid Zolt executable.');
            foundBinary = true;
        }
        entries.push({ content, mode, path: path.replace(/\/$/u, ''), type });
        if (entries.length > MAX_ARCHIVE_ENTRIES) throw archiveError('The Zolt archive has too many entries.');
        offset += Math.ceil(size / 512) * 512;
    }
    if (!ended || !foundBinary) throw archiveError(`Archive is missing ${expectedRoot}/bin/zolt or its end marker.`);
    for (let index = offset; index < tar.length; index += 1) {
        if (tar[index] !== 0) throw archiveError('The Zolt archive contains trailing data.');
    }
    return entries;
}

function validateChecksum(header: Buffer): void {
    const expected = octal(header.subarray(148, 156), 'checksum');
    let actual = 0;
    for (let index = 0; index < header.length; index += 1) {
        actual += index >= 148 && index < 156 ? 32 : header[index] ?? 0;
    }
    if (actual !== expected) throw archiveError('The Zolt archive contains an invalid tar checksum.');
}

function validatePath(path: string, expectedRoot: string): void {
    if (path === '' || path.includes('\\') || path.includes('\0') || /[\u0000-\u001F\u007F]/u.test(path) || isAbsolute(path)) {
        throw archiveError(`Archive entry has an unsafe path: ${path}.`);
    }
    const normalized = posix.normalize(path);
    if (normalized !== path || normalized === '..' || normalized.startsWith('../')) {
        throw archiveError(`Archive entry has an unsafe path: ${path}.`);
    }
    if (normalized.split('/')[0] !== expectedRoot) {
        throw archiveError(`Archive entry is outside expected root ${expectedRoot}: ${path}.`);
    }
}

function text(field: Buffer): string {
    const zero = field.indexOf(0);
    const bytes = zero === -1 ? field : field.subarray(0, zero);
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
        throw archiveError('The Zolt archive contains a non-UTF-8 path.', error);
    }
}

function octal(field: Buffer, label: string): number {
    const value = field.toString('ascii').replaceAll('\0', '').trim();
    if (!/^[0-7]+$/u.test(value)) throw archiveError(`The Zolt archive has an invalid ${label} field.`);
    const parsed = Number.parseInt(value, 8);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw archiveError(`The Zolt archive has an invalid ${label} field.`);
    return parsed;
}

function archiveError(message: string, cause?: unknown): Error {
    return actionError('ZOLT-INSTALL-010', message, cause);
}

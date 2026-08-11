import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_REPOSITORY_BLOB_BYTES, MAX_REPOSITORY_VIEW_BYTES, MAX_REPOSITORY_VIEW_ENTRIES, } from '../constants.js';
import { actionError } from '../errors.js';
import { canonicalRelativeFile } from '../paths.js';
export async function inspectRepositoryTree(root, entries) {
    const expectedFiles = new Map(entries.map((entry) => [entry.path, entry]));
    const expectedDirectories = directoryPaths(entries);
    const seenFiles = new Set();
    const seenDirectories = new Set();
    const foldedPaths = new Set();
    const added = [];
    const modeChanged = [];
    const modified = [];
    const unexpectedDirectories = [];
    let actualEntries = 0;
    let actualBytes = 0;
    await visit(root, '');
    const deleted = [...expectedFiles.keys()].filter((path) => !seenFiles.has(path)).sort();
    const missingDirectories = [...expectedDirectories].filter((path) => !seenDirectories.has(path)).sort();
    const paths = [...new Set([...added, ...deleted, ...modeChanged, ...modified])].sort();
    return Object.freeze({
        added: Object.freeze(added.sort()),
        deleted: Object.freeze(deleted),
        missingDirectories: Object.freeze(missingDirectories),
        modeChanged: Object.freeze(modeChanged.sort()),
        modified: Object.freeze(modified.sort()),
        paths: Object.freeze(paths),
        unexpectedDirectories: Object.freeze(unexpectedDirectories.sort()),
    });
    async function visit(directory, prefix) {
        const children = await readdir(directory, { withFileTypes: true });
        children.sort((left, right) => left.name.localeCompare(right.name));
        for (const child of children) {
            const path = canonicalRelativeFile(prefix === '' ? child.name : `${prefix}/${child.name}`, 'repository entry');
            const folded = path.toLowerCase();
            if (foldedPaths.has(folded)) {
                throw actionError('ZOLT-REPOSITORY-007', `Repository copy contains a case-colliding path: ${path}.`);
            }
            foldedPaths.add(folded);
            actualEntries += 1;
            if (actualEntries > MAX_REPOSITORY_VIEW_ENTRIES) {
                throw actionError('ZOLT-REPOSITORY-008', 'Repository copy exceeds the entry limit.');
            }
            const candidate = join(root, ...path.split('/'));
            const info = await lstat(candidate);
            if (info.isSymbolicLink()) {
                throw actionError('ZOLT-REPOSITORY-009', `Repository copy contains a symbolic link: ${path}.`);
            }
            if (info.isDirectory()) {
                seenDirectories.add(path);
                if (!expectedDirectories.has(path))
                    unexpectedDirectories.push(path);
                await visit(candidate, path);
                continue;
            }
            if (!info.isFile()) {
                throw actionError('ZOLT-REPOSITORY-009', `Repository copy contains an unsupported entry: ${path}.`);
            }
            if ((info.mode & 0o7000) !== 0) {
                throw actionError('ZOLT-REPOSITORY-009', `Repository copy contains privilege bits: ${path}.`);
            }
            actualBytes += info.size;
            if (info.size > MAX_REPOSITORY_BLOB_BYTES || actualBytes > MAX_REPOSITORY_VIEW_BYTES) {
                throw actionError('ZOLT-REPOSITORY-005', `Repository copy file ${path} exceeds safety limits.`);
            }
            const expected = expectedFiles.get(path);
            if (expected === undefined) {
                added.push(path);
                if ((info.mode & 0o111) !== 0)
                    modeChanged.push(path);
                continue;
            }
            seenFiles.add(path);
            const executable = (info.mode & 0o111) !== 0;
            if (executable !== (expected.mode === '100755'))
                modeChanged.push(path);
            if (info.size !== expected.size || await gitBlobId(candidate, info.size, expected.object.length) !== expected.object) {
                modified.push(path);
            }
        }
    }
}
export async function verifyRepositoryTree(root, entries) {
    const changes = await inspectRepositoryTree(root, entries);
    if (changes.unexpectedDirectories.length !== 0) {
        throw actionError('ZOLT-REPOSITORY-009', `Immutable repository view contains an unexpected directory: ${changes.unexpectedDirectories[0]}.`);
    }
    if (changes.missingDirectories.length !== 0) {
        throw actionError('ZOLT-REPOSITORY-009', `Immutable repository directory changed during analysis: ${changes.missingDirectories[0]}.`);
    }
    if (changes.added.length !== 0) {
        throw actionError('ZOLT-REPOSITORY-009', `Immutable repository view contains an unexpected file: ${changes.added[0]}.`);
    }
    if (changes.deleted.length !== 0) {
        throw actionError('ZOLT-REPOSITORY-009', `Immutable repository entry changed during analysis: ${changes.deleted[0]}.`);
    }
    if (changes.modeChanged.length !== 0) {
        throw actionError('ZOLT-REPOSITORY-009', `Immutable repository mode changed during analysis: ${changes.modeChanged[0]}.`);
    }
    if (changes.modified.length !== 0) {
        throw actionError('ZOLT-REPOSITORY-009', `Immutable repository bytes changed during analysis: ${changes.modified[0]}.`);
    }
}
function directoryPaths(entries) {
    const directories = new Set();
    for (const entry of entries) {
        const parts = entry.path.split('/');
        for (let index = 1; index < parts.length; index += 1) {
            directories.add(parts.slice(0, index).join('/'));
        }
    }
    return directories;
}
async function gitBlobId(path, size, objectLength) {
    const algorithm = objectLength === 40 ? 'sha1' : objectLength === 64 ? 'sha256' : undefined;
    if (algorithm === undefined) {
        throw actionError('ZOLT-REPOSITORY-003', 'The repository uses an unsupported Git object format.');
    }
    const digest = createHash(algorithm);
    digest.update(`blob ${size.toString()}\0`, 'utf8');
    for await (const chunk of createReadStream(path))
        digest.update(chunk);
    return digest.digest('hex');
}

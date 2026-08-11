import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
    MAX_REPOSITORY_BLOB_BYTES,
    MAX_REPOSITORY_VIEW_BYTES,
    MAX_REPOSITORY_VIEW_ENTRIES,
} from '../constants.js';
import { actionError, UpdateDependenciesError } from '../errors.js';
import { canonicalRelativeFile, containedRoot } from '../paths.js';
import { execText } from '../process.js';
import type { MutableRepositoryCopy, RepositoryView } from '../types.js';
import {
    inspectRepositoryTree,
    type RepositoryTreeEntry,
    verifyRepositoryTree,
} from './repository-tree.js';

export interface RepositoryViewInput {
    readonly directory: string;
    readonly expectedSha: string;
    readonly workspace: string;
}

export async function createRepositoryView(
    input: RepositoryViewInput,
    dependencies: { readonly environment?: NodeJS.ProcessEnv } = {},
): Promise<RepositoryView> {
    const environment = dependencies.environment ?? process.env;
    validateDirectoryInput(input.directory);
    validateExpectedSha(input.expectedSha);
    const repository = await requireRepositoryRoot(input.workspace);
    await execText('git', ['-C', repository, 'cat-file', '-e', `${input.expectedSha}^{commit}`], {
        label: 'Commit verification',
        maxBuffer: 1024 * 1024,
    });
    const entries = await readTree(repository, input.expectedSha);
    const temporaryBase = environment.RUNNER_TEMP ?? tmpdir();
    await mkdir(temporaryBase, { recursive: true });
    const work = await mkdtemp(join(temporaryBase, 'zolt-update-dependencies-'));
    const privateWorkspace = join(work, 'repository');
    const archive = join(work, 'repository.tar');
    let retained = false;
    try {
        await mkdir(privateWorkspace, { mode: 0o700, recursive: true });
        await createArchive(repository, input.expectedSha, archive);
        await extractArchive(archive, privateWorkspace, 'Immutable repository extraction');
        await verifyRepositoryTree(privateWorkspace, entries);
        const directory = await requireSelectedDirectory(privateWorkspace, input.directory);
        retained = true;
        return Object.freeze({
            cleanup: async () => rm(work, { force: true, recursive: true }),
            createMutableCopy: async () => createMutableRepositoryCopy(
                work,
                archive,
                entries,
                input.directory,
            ),
            directory,
            directoryInput: input.directory,
            verify: async () => verifyRepositoryTree(privateWorkspace, entries),
            workspace: privateWorkspace,
        });
    } finally {
        if (!retained) await rm(work, { force: true, recursive: true });
    }
}

async function createMutableRepositoryCopy(
    work: string,
    archive: string,
    entries: readonly RepositoryTreeEntry[],
    directoryInput: string,
): Promise<MutableRepositoryCopy> {
    const root = await mkdtemp(join(work, 'mutable-'));
    const workspace = join(root, 'repository');
    let retained = false;
    try {
        await mkdir(workspace, { mode: 0o700, recursive: true });
        await extractArchive(archive, workspace, 'Mutable repository extraction');
        await verifyRepositoryTree(workspace, entries);
        const directory = await requireSelectedDirectory(workspace, directoryInput);
        retained = true;
        return Object.freeze({
            cleanup: async () => rm(root, { force: true, recursive: true }),
            directory,
            directoryInput,
            inspectChanges: async () => inspectRepositoryTree(workspace, entries),
            workspace,
        });
    } finally {
        if (!retained) await rm(root, { force: true, recursive: true });
    }
}

async function extractArchive(archive: string, workspace: string, label: string): Promise<void> {
    await execText('tar', ['-xf', archive, '-C', workspace], {
        label,
        maxBuffer: 1024 * 1024,
        timeout: 120_000,
    });
}

async function requireSelectedDirectory(workspace: string, input: string): Promise<string> {
    const directory = containedRoot(workspace, input, 'selected directory');
    const info = await lstat(directory).catch((error: unknown) => {
        throw actionError('ZOLT-REPOSITORY-011', `Selected directory does not exist at GITHUB_SHA: ${input}.`, error);
    });
    if (!info.isDirectory() || info.isSymbolicLink()) {
        throw actionError('ZOLT-REPOSITORY-011', `Selected directory is not a regular directory: ${input}.`);
    }
    return directory;
}

async function requireRepositoryRoot(workspace: string): Promise<string> {
    const result = await execText('git', ['-C', workspace, 'rev-parse', '--show-toplevel'], {
        label: 'Git repository discovery',
        maxBuffer: 1024 * 1024,
    });
    const root = await realpath(result.stdout.trim());
    const expected = await realpath(workspace);
    if (resolve(root) !== resolve(expected)) {
        throw actionError(
            'ZOLT-REPOSITORY-001',
            'GITHUB_WORKSPACE must be the root of the checked-out repository.',
        );
    }
    return root;
}

async function readTree(repository: string, sha: string): Promise<readonly RepositoryTreeEntry[]> {
    const result = await execText('git', ['-C', repository, 'ls-tree', '-rz', '-l', '--full-tree', sha], {
        label: 'Immutable repository listing',
        maxBuffer: 128 * 1024 * 1024,
        timeout: 120_000,
    });
    if (result.stdout.includes('\uFFFD')) {
        throw actionError('ZOLT-REPOSITORY-002', 'Repository contains a path that is not valid UTF-8.');
    }
    const entries: RepositoryTreeEntry[] = [];
    const caseFolded = new Set<string>();
    let totalBytes = 0;
    for (const record of result.stdout.split('\0')) {
        if (record === '') continue;
        const match = /^([0-7]{6}) (blob|commit) ((?:[0-9a-f]{40}|[0-9a-f]{64})) +([0-9]+|-)\t([\s\S]+)$/u.exec(record);
        if (match === null) throw actionError('ZOLT-REPOSITORY-003', 'Could not decode the Git tree listing.');
        const [, mode, type, object, sizeText, entryPath] = match;
        if (
            entryPath === undefined
            || mode === undefined
            || type === undefined
            || object === undefined
            || sizeText === undefined
        ) {
            throw actionError('ZOLT-REPOSITORY-003', 'Could not decode the Git tree listing.');
        }
        canonicalRelativeFile(entryPath, 'repository tree path');
        if (type !== 'blob' || mode === '120000' || mode === '160000' || sizeText === '-') {
            throw actionError(
                'ZOLT-REPOSITORY-004',
                `Repository entry ${entryPath} is a symlink, submodule, or unsupported object.`,
            );
        }
        if (mode !== '100644' && mode !== '100755') {
            throw actionError('ZOLT-REPOSITORY-004', `Repository entry ${entryPath} has unsupported mode ${mode}.`);
        }
        const size = Number(sizeText);
        if (!Number.isSafeInteger(size) || size < 0 || size > MAX_REPOSITORY_BLOB_BYTES) {
            throw actionError('ZOLT-REPOSITORY-005', `Repository blob ${entryPath} exceeds safety limits.`);
        }
        totalBytes += size;
        if (totalBytes > MAX_REPOSITORY_VIEW_BYTES) {
            throw actionError('ZOLT-REPOSITORY-006', 'Repository exceeds the immutable-view byte limit.');
        }
        const folded = entryPath.toLowerCase();
        if (caseFolded.has(folded)) {
            throw actionError('ZOLT-REPOSITORY-007', `Repository contains a case-colliding path: ${entryPath}.`);
        }
        caseFolded.add(folded);
        entries.push({ mode, object, path: entryPath, size });
        if (entries.length > MAX_REPOSITORY_VIEW_ENTRIES) {
            throw actionError('ZOLT-REPOSITORY-008', 'Repository exceeds the immutable-view entry limit.');
        }
    }
    return Object.freeze(entries);
}

async function createArchive(repository: string, sha: string, destination: string): Promise<void> {
    const child = spawn('git', ['-C', repository, 'archive', '--format=tar', sha], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 16 * 1024) stderr += chunk;
    });
    const completed = new Promise<void>((resolvePromise, rejectPromise) => {
        child.once('error', rejectPromise);
        child.once('exit', (code, signal) => {
            if (code === 0) {
                resolvePromise();
                return;
            }
            rejectPromise(actionError(
                'ZOLT-REPOSITORY-010',
                `Could not create the immutable repository archive; git exited with ${code?.toString() ?? signal ?? 'unknown status'}.${stderr === '' ? '' : ` ${stderr.trim()}`}`,
            ));
        });
    });
    try {
        await Promise.all([pipeline(child.stdout, output), completed]);
    } catch (error) {
        child.kill('SIGKILL');
        if (error instanceof UpdateDependenciesError) throw error;
        throw actionError('ZOLT-REPOSITORY-010', 'Could not create the immutable repository archive.', error);
    }
}

function validateExpectedSha(value: string): void {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(value)) {
        throw actionError('ZOLT-REPOSITORY-013', 'expectedSha must be a full 40- or 64-character commit SHA.');
    }
}

function validateDirectoryInput(value: string): void {
    if (value === '.') return;
    canonicalRelativeFile(value, 'selected directory');
    if (posix.normalize(value) !== value) {
        throw actionError('ZOLT-REPOSITORY-012', `Selected directory is not canonical: ${JSON.stringify(value)}.`);
    }
}

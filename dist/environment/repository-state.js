import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { MAX_REPOSITORY_BLOB_BYTES, MAX_REPOSITORY_VIEW_BYTES, MAX_REPOSITORY_VIEW_ENTRIES, } from '../constants.js';
import { actionError, UpdateDependenciesError } from '../errors.js';
import { execText } from '../process.js';
export async function createRepositoryView(input, dependencies = {}) {
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
        await execText('tar', ['-xf', archive, '-C', privateWorkspace], {
            label: 'Immutable repository extraction',
            maxBuffer: 1024 * 1024,
            timeout: 120_000,
        });
        await verifyExtractedTree(privateWorkspace, entries);
        const directory = containedPath(privateWorkspace, input.directory);
        const info = await lstat(directory).catch((error) => {
            throw actionError('ZOLT-REPOSITORY-011', `Selected directory does not exist at GITHUB_SHA: ${input.directory}.`, error);
        });
        if (!info.isDirectory() || info.isSymbolicLink()) {
            throw actionError('ZOLT-REPOSITORY-011', `Selected directory is not a regular directory: ${input.directory}.`);
        }
        retained = true;
        return Object.freeze({
            cleanup: async () => rm(work, { force: true, recursive: true }),
            directory,
            directoryInput: input.directory,
            workspace: privateWorkspace,
        });
    }
    finally {
        if (!retained)
            await rm(work, { force: true, recursive: true });
    }
}
async function requireRepositoryRoot(workspace) {
    const result = await execText('git', ['-C', workspace, 'rev-parse', '--show-toplevel'], {
        label: 'Git repository discovery',
        maxBuffer: 1024 * 1024,
    });
    const root = await realpath(result.stdout.trim());
    const expected = await realpath(workspace);
    if (resolve(root) !== resolve(expected)) {
        throw actionError('ZOLT-REPOSITORY-001', 'GITHUB_WORKSPACE must be the root of the checked-out repository.');
    }
    return root;
}
async function readTree(repository, sha) {
    const result = await execText('git', ['-C', repository, 'ls-tree', '-rz', '-l', '--full-tree', sha], {
        label: 'Immutable repository listing',
        maxBuffer: 128 * 1024 * 1024,
        timeout: 120_000,
    });
    if (result.stdout.includes('\uFFFD')) {
        throw actionError('ZOLT-REPOSITORY-002', 'Repository contains a path that is not valid UTF-8.');
    }
    const entries = [];
    const caseFolded = new Set();
    let totalBytes = 0;
    for (const record of result.stdout.split('\0')) {
        if (record === '')
            continue;
        const match = /^([0-7]{6}) (blob|commit) ([0-9a-f]{40,64}) +([0-9]+|-)\t([\s\S]+)$/u.exec(record);
        if (match === null)
            throw actionError('ZOLT-REPOSITORY-003', 'Could not decode the Git tree listing.');
        const [, mode, type, , sizeText, entryPath] = match;
        if (entryPath === undefined || mode === undefined || type === undefined || sizeText === undefined) {
            throw actionError('ZOLT-REPOSITORY-003', 'Could not decode the Git tree listing.');
        }
        validateTreePath(entryPath);
        if (type !== 'blob' || mode === '120000' || mode === '160000' || sizeText === '-') {
            throw actionError('ZOLT-REPOSITORY-004', `Repository entry ${entryPath} is a symlink, submodule, or unsupported object.`);
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
        entries.push({ mode, path: entryPath, size });
        if (entries.length > MAX_REPOSITORY_VIEW_ENTRIES) {
            throw actionError('ZOLT-REPOSITORY-008', 'Repository exceeds the immutable-view entry limit.');
        }
    }
    return entries;
}
async function createArchive(repository, sha, destination) {
    const child = spawn('git', ['-C', repository, 'archive', '--format=tar', sha], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
        if (stderr.length < 16 * 1024)
            stderr += chunk;
    });
    const completed = new Promise((resolvePromise, rejectPromise) => {
        child.once('error', rejectPromise);
        child.once('exit', (code, signal) => {
            if (code === 0) {
                resolvePromise();
                return;
            }
            rejectPromise(actionError('ZOLT-REPOSITORY-010', `Could not create the immutable repository archive; git exited with ${code?.toString() ?? signal ?? 'unknown status'}.${stderr === '' ? '' : ` ${stderr.trim()}`}`));
        });
    });
    try {
        await Promise.all([pipeline(child.stdout, output), completed]);
    }
    catch (error) {
        child.kill('SIGKILL');
        if (error instanceof UpdateDependenciesError)
            throw error;
        throw actionError('ZOLT-REPOSITORY-010', 'Could not create the immutable repository archive.', error);
    }
}
async function verifyExtractedTree(root, entries) {
    for (const entry of entries) {
        const candidate = containedPath(root, entry.path);
        const info = await lstat(candidate);
        const executable = (info.mode & 0o111) !== 0;
        if (!info.isFile()
            || info.isSymbolicLink()
            || info.size !== entry.size
            || executable !== (entry.mode === '100755')) {
            throw actionError('ZOLT-REPOSITORY-009', `Immutable repository entry changed during extraction: ${entry.path}.`);
        }
    }
}
function validateExpectedSha(value) {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(value)) {
        throw actionError('ZOLT-REPOSITORY-013', 'expectedSha must be a full 40- or 64-character commit SHA.');
    }
}
function validateDirectoryInput(value) {
    if (value === ''
        || value.includes('\\')
        || value.includes('\0')
        || /[\u0000-\u001F\u007F]/u.test(value)
        || posix.isAbsolute(value)) {
        throw actionError('ZOLT-REPOSITORY-012', `Selected directory is unsafe: ${JSON.stringify(value)}.`);
    }
    const normalized = posix.normalize(value);
    if (normalized !== value || normalized === '..' || normalized.startsWith('../')) {
        throw actionError('ZOLT-REPOSITORY-012', `Selected directory is not canonical or escapes the repository: ${JSON.stringify(value)}.`);
    }
}
function validateTreePath(value) {
    if (value === ''
        || value.includes('\\')
        || value.includes('\0')
        || /[\u0000-\u001F\u007F]/u.test(value)
        || posix.isAbsolute(value)) {
        throw actionError('ZOLT-REPOSITORY-012', `Repository contains an unsafe path: ${JSON.stringify(value)}.`);
    }
    const normalized = posix.normalize(value);
    if (normalized !== value || normalized === '..' || normalized.startsWith('../')) {
        throw actionError('ZOLT-REPOSITORY-012', `Repository contains an unsafe path: ${JSON.stringify(value)}.`);
    }
}
function containedPath(root, value) {
    if (isAbsolute(value)) {
        throw actionError('ZOLT-REPOSITORY-012', `Path is not repository-relative: ${JSON.stringify(value)}.`);
    }
    const candidate = resolve(root, value);
    const relation = relative(root, candidate);
    if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
        throw actionError('ZOLT-REPOSITORY-012', `Path escapes the immutable repository view: ${JSON.stringify(value)}.`);
    }
    return candidate;
}

import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { UpdateDependenciesError } from '../errors.js';
import type { RepositoryView, WorkspaceMode, ZoltProjectSelection } from '../types.js';

const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
const WORKSPACE_TABLE = /^\s*\[\s*workspace\s*\]\s*(?:#.*)?$/mu;

interface WorkspaceLocation {
    readonly manifest: string;
    readonly root: string;
}

export async function selectZoltProject(
    repository: RepositoryView,
    workspaceMode: WorkspaceMode,
): Promise<ZoltProjectSelection> {
    if (workspaceMode === 'false') return standalone(repository, repository.directory);
    const workspaceRoot = await discoverWorkspace(repository);
    if (workspaceRoot !== undefined) return workspace(repository, workspaceRoot);
    if (workspaceMode === 'true') {
        throw new UpdateDependenciesError(
            'ZOLT-WORKSPACE-001',
            `No Zolt workspace was found from ${repository.directoryInput}. Expected zolt.toml with [workspace] or zolt-workspace.toml.`,
        );
    }
    return standalone(repository, repository.directory);
}

async function discoverWorkspace(repository: RepositoryView): Promise<WorkspaceLocation | undefined> {
    let current = repository.directory;
    while (contained(repository.workspace, current)) {
        const legacy = await regularFileInside(resolve(current, 'zolt-workspace.toml'), repository.workspace);
        const rootConfig = await regularFileInside(resolve(current, 'zolt.toml'), repository.workspace);
        const modern = rootConfig === undefined ? false : await containsWorkspaceTable(rootConfig);
        if (legacy !== undefined && modern) {
            throw new UpdateDependenciesError(
                'ZOLT-WORKSPACE-007',
                `Workspace at ${repositoryRelativeRoot(repository.workspace, current)} declares both zolt-workspace.toml and [workspace] in zolt.toml.`,
            );
        }
        if (legacy !== undefined) return { manifest: legacy, root: current };
        if (modern && rootConfig !== undefined) return { manifest: rootConfig, root: current };
        if (current === repository.workspace) break;
        current = dirname(current);
    }
    return undefined;
}

async function workspace(repository: RepositoryView, location: WorkspaceLocation): Promise<ZoltProjectSelection> {
    const lockfile = await requiredFile(resolve(location.root, 'zolt.lock'), repository.workspace, 'workspace zolt.lock');
    return {
        lockfilePath: repositoryRelative(repository.workspace, lockfile),
        manifestPath: repositoryRelative(repository.workspace, location.manifest),
        mode: 'workspace',
        relativeRoot: repositoryRelativeRoot(repository.workspace, location.root),
        root: location.root,
    };
}

async function standalone(repository: RepositoryView, root: string): Promise<ZoltProjectSelection> {
    const manifest = await requiredFile(resolve(root, 'zolt.toml'), repository.workspace, 'standalone zolt.toml');
    const lockfile = await requiredFile(resolve(root, 'zolt.lock'), repository.workspace, 'standalone zolt.lock');
    return {
        lockfilePath: repositoryRelative(repository.workspace, lockfile),
        manifestPath: repositoryRelative(repository.workspace, manifest),
        mode: 'project',
        relativeRoot: repositoryRelativeRoot(repository.workspace, root),
        root,
    };
}

async function requiredFile(candidate: string, workspaceRoot: string, label: string): Promise<string> {
    const file = await regularFileInside(candidate, workspaceRoot);
    if (file === undefined) throw new UpdateDependenciesError('ZOLT-WORKSPACE-002', `Required ${label} was not found.`);
    return file;
}

async function regularFileInside(
    candidate: string,
    workspaceRoot: string,
): Promise<string | undefined> {
    try {
        const logical = await lstat(candidate);
        if (!logical.isFile() || logical.isSymbolicLink()) {
            throw new UpdateDependenciesError('ZOLT-WORKSPACE-004', `Expected a regular file at ${candidate}.`);
        }
        const resolved = await realpath(candidate);
        if (!contained(workspaceRoot, resolved)) {
            throw new UpdateDependenciesError('ZOLT-WORKSPACE-003', `Configuration path resolves outside the repository view: ${candidate}.`);
        }
        return resolved;
    } catch (error) {
        if (error instanceof UpdateDependenciesError) throw error;
        if ((error as { readonly code?: string }).code === 'ENOENT') return undefined;
        throw new UpdateDependenciesError('ZOLT-WORKSPACE-005', `Could not inspect ${candidate}.`, { cause: error });
    }
}

async function containsWorkspaceTable(candidate: string): Promise<boolean> {
    const info = await lstat(candidate);
    if (info.size > MAX_CONFIG_BYTES) {
        throw new UpdateDependenciesError('ZOLT-WORKSPACE-006', `Zolt config exceeds ${MAX_CONFIG_BYTES.toString()} bytes.`);
    }
    return WORKSPACE_TABLE.test(await readFile(candidate, 'utf8'));
}

function repositoryRelative(workspaceRoot: string, candidate: string): string {
    const value = relative(workspaceRoot, candidate);
    if (value === '' || isAbsolute(value) || value === '..' || value.startsWith(`..${sep}`)) {
        throw new UpdateDependenciesError('ZOLT-WORKSPACE-003', `Path is outside the repository view: ${candidate}.`);
    }
    return value.split(sep).join('/');
}

function repositoryRelativeRoot(workspaceRoot: string, candidate: string): string {
    const value = relative(workspaceRoot, candidate);
    if (isAbsolute(value) || value === '..' || value.startsWith(`..${sep}`)) {
        throw new UpdateDependenciesError('ZOLT-WORKSPACE-003', `Project root is outside the repository view: ${candidate}.`);
    }
    return value === '' ? '.' : value.split(sep).join('/');
}

function contained(root: string, candidate: string): boolean {
    const value = relative(root, candidate);
    return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`));
}

import { isAbsolute, posix, relative, resolve, sep } from 'node:path';

import { actionError } from './errors.js';
import { canonicalTargetPath } from './zolt/target-id.js';

const CONTROL = /[\u0000-\u001F\u007F]/u;

export function canonicalRelativeFile(value: string, label: string): string {
    if (
        value === ''
        || value === '.'
        || value.endsWith('/')
        || Buffer.byteLength(value, 'utf8') > 4096
        || value.includes('\\')
        || value.includes('\0')
        || CONTROL.test(value)
        || posix.isAbsolute(value)
    ) {
        throw pathError(label, value);
    }
    const normalized = posix.normalize(value);
    if (normalized !== value || normalized === '..' || normalized.startsWith('../')) {
        throw pathError(label, value);
    }
    return value;
}

export function canonicalZoltManifestPath(value: string, label: string): string {
    const path = canonicalRelativeFile(canonicalTargetPath(value, label), label);
    if (posix.basename(path) !== 'zolt.toml') {
        throw actionError('ZOLT-PATH-003', `${label} must identify a zolt.toml manifest.`);
    }
    return path;
}

export function canonicalZoltRootLockPath(value: string, label: string): string {
    const path = canonicalRelativeFile(canonicalTargetPath(value, label), label);
    if (path !== 'zolt.lock') {
        throw actionError('ZOLT-PATH-003', `${label} must identify the mutation root zolt.lock.`);
    }
    return path;
}

export function canonicalRelativeRoot(value: string, label: string): string {
    if (value === '.') return value;
    return canonicalRelativeFile(value, label);
}

export function joinRelativeRoot(root: string, child: string, label: string): string {
    const checkedRoot = canonicalRelativeRoot(root, `${label} root`);
    const checkedChild = canonicalRelativeFile(child, label);
    return checkedRoot === '.'
        ? checkedChild
        : canonicalRelativeFile(posix.join(checkedRoot, checkedChild), label);
}

export function containedFile(root: string, path: string, label: string): string {
    return contained(root, canonicalRelativeFile(path, label), label);
}

export function containedRoot(root: string, path: string, label: string): string {
    const checked = canonicalRelativeRoot(path, label);
    return checked === '.' ? resolve(root) : contained(root, checked, label);
}

function contained(root: string, path: string, label: string): string {
    const canonicalRoot = resolve(root);
    const candidate = resolve(canonicalRoot, path);
    const relation = relative(canonicalRoot, candidate);
    if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
        throw actionError('ZOLT-PATH-002', `${label} escapes its repository root.`);
    }
    return candidate;
}

function pathError(label: string, value: string): ReturnType<typeof actionError> {
    return actionError(
        'ZOLT-PATH-001',
        `${label} must be a canonical repository-relative POSIX path: ${JSON.stringify(value)}.`,
    );
}

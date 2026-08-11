import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { actionError } from './errors.js';
const CONTROL = /[\u0000-\u001F\u007F]/u;
export function canonicalRelativeFile(value, label) {
    if (value === ''
        || value === '.'
        || value.endsWith('/')
        || Buffer.byteLength(value, 'utf8') > 4096
        || value.includes('\\')
        || value.includes('\0')
        || CONTROL.test(value)
        || posix.isAbsolute(value)) {
        throw pathError(label, value);
    }
    const normalized = posix.normalize(value);
    if (normalized !== value || normalized === '..' || normalized.startsWith('../')) {
        throw pathError(label, value);
    }
    return value;
}
export function canonicalZoltManifestPath(value, label) {
    const path = canonicalRelativeFile(value, label);
    if (posix.basename(path) !== 'zolt.toml') {
        throw actionError('ZOLT-PATH-003', `${label} must identify a zolt.toml manifest.`);
    }
    return path;
}
export function canonicalZoltRootLockPath(value, label) {
    const path = canonicalRelativeFile(value, label);
    if (path !== 'zolt.lock') {
        throw actionError('ZOLT-PATH-003', `${label} must identify the mutation root zolt.lock.`);
    }
    return path;
}
export function canonicalRelativeRoot(value, label) {
    if (value === '.')
        return value;
    return canonicalRelativeFile(value, label);
}
export function joinRelativeRoot(root, child, label) {
    const checkedRoot = canonicalRelativeRoot(root, `${label} root`);
    const checkedChild = canonicalRelativeFile(child, label);
    return checkedRoot === '.'
        ? checkedChild
        : canonicalRelativeFile(posix.join(checkedRoot, checkedChild), label);
}
export function containedFile(root, path, label) {
    return contained(root, canonicalRelativeFile(path, label), label);
}
export function containedRoot(root, path, label) {
    const checked = canonicalRelativeRoot(path, label);
    return checked === '.' ? resolve(root) : contained(root, checked, label);
}
function contained(root, path, label) {
    const canonicalRoot = resolve(root);
    const candidate = resolve(canonicalRoot, path);
    const relation = relative(canonicalRoot, candidate);
    if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
        throw actionError('ZOLT-PATH-002', `${label} escapes its repository root.`);
    }
    return candidate;
}
function pathError(label, value) {
    return actionError('ZOLT-PATH-001', `${label} must be a canonical repository-relative POSIX path: ${JSON.stringify(value)}.`);
}

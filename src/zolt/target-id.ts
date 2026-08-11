import { createHash } from 'node:crypto';

import { actionError } from '../errors.js';
import { isCanonicalDigestIdentifier } from '../identifiers.js';
import type { OutdatedSurface } from '../types.js';

const DOMAIN = Buffer.from('zolt-update-target\0', 'ascii');
const ID_VERSION = Buffer.from([1]);
const ISO_CONTROL = /[\u0000-\u001F\u007F-\u009F]/u;
const JAVA_BLANK = /^[\u0009-\u000D\u001C-\u0020\u1680\u2000-\u2006\u2008-\u200A\u2028\u2029\u205F\u3000]+$/u;

export interface ZoltTargetIdentity {
    readonly identifier: string;
    readonly manifestPath: string;
    readonly section: string;
    readonly surface: OutdatedSurface;
}

export function createZoltTargetId(identity: ZoltTargetIdentity): string {
    const manifestPath = canonicalTargetPath(identity.manifestPath, 'target manifestPath');
    const surface = canonicalTargetText(identity.surface, 'target surface');
    const section = canonicalTargetText(identity.section, 'target section');
    const identifier = canonicalTargetText(identity.identifier, 'target identifier');
    const digest = createHash('sha256');
    digest.update(DOMAIN);
    digest.update(ID_VERSION);
    updateField(digest, manifestPath);
    updateField(digest, surface);
    updateField(digest, section);
    updateField(digest, identifier);
    return `zt1_${digest.digest('base64url')}`;
}

export function requireMatchingZoltTargetId(
    targetId: string,
    identity: ZoltTargetIdentity,
    label: string,
): string {
    if (!isCanonicalDigestIdentifier(targetId, 'zt1_')) {
        throw targetError(`${label} must be a canonical zt1_ target ID.`);
    }
    const expected = createZoltTargetId(identity);
    if (targetId !== expected) {
        throw targetError(`${label} does not match its canonical Zolt target identity fields.`);
    }
    return targetId;
}

export function canonicalTargetPath(value: string, label: string): string {
    const canonical = canonicalTargetText(value, label);
    if (canonical.startsWith('/') || canonical.includes('\\')) {
        throw targetError(`${label} must be a relative POSIX path.`);
    }
    const segments = canonical.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
        throw targetError(`${label} must be normalized.`);
    }
    return canonical;
}

export function canonicalTargetText(value: string, label: string): string {
    if (
        value === ''
        || JAVA_BLANK.test(value)
        || value.normalize('NFC') !== value
        || ISO_CONTROL.test(value)
        || !hasValidUnicode(value)
    ) {
        throw targetError(`${label} must be non-blank canonical Unicode NFC text without controls.`);
    }
    return value;
}

function hasValidUnicode(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xD800 && code <= 0xDBFF) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
            index += 1;
        } else if (code >= 0xDC00 && code <= 0xDFFF) {
            return false;
        }
    }
    return true;
}

function updateField(digest: ReturnType<typeof createHash>, value: string): void {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    digest.update(length);
    digest.update(bytes);
}

function targetError(message: string): ReturnType<typeof actionError> {
    return actionError('ZOLT-CONTRACT-001', message);
}

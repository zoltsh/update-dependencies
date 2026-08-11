import { createHash } from 'node:crypto';
import { actionError } from '../errors.js';
import { isCanonicalDigestIdentifier } from '../identifiers.js';
import { canonicalRelativeRoot } from '../paths.js';
export function previewTargetId(target) {
    const canonical = JSON.stringify({
        identifier: target.identifier,
        manifestPath: target.manifestPath,
        schema: 1,
        section: target.section,
        surface: target.surface,
    });
    const digest = createHash('sha256').update(canonical).digest();
    return `pzt1_${digest.toString('base64url').slice(0, 18)}`;
}
export function managedTargetIdentity(zoltRoot, targetId) {
    const authoritative = isCanonicalDigestIdentifier(targetId, 'zt1_');
    const provisional = /^pzt1_[A-Za-z0-9_-]{18}$/u.test(targetId);
    if (!authoritative && !provisional) {
        throw actionError('ZOLT-IDENTITY-001', 'Managed identity requires a canonical Zolt or preview target ID.');
    }
    const canonicalRoot = canonicalRelativeRoot(zoltRoot, 'managed identity Zolt root');
    const digest = createHash('sha256');
    field(digest, 'zolt-update-dependencies-managed-target-v1');
    field(digest, canonicalRoot);
    field(digest, targetId);
    const bytes = digest.digest();
    return Object.freeze({
        branchHash: bytes.toString('hex').slice(0, 10),
        managedId: authoritative
            ? `zud1_${bytes.toString('base64url')}`
            : `pzud1_${bytes.toString('base64url').slice(0, 22)}`,
        targetId,
    });
}
export function branchSlug(identifier) {
    const artifact = identifier.includes(':') ? identifier.slice(identifier.lastIndexOf(':') + 1) : identifier;
    const normalized = artifact
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 42)
        .replace(/-+$/gu, '');
    return normalized === '' ? 'dependency' : normalized;
}
function field(digest, value) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    digest.update(length);
    digest.update(bytes);
}

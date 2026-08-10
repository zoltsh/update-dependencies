import { createHash } from 'node:crypto';
export function previewTargetIdentity(target) {
    const canonical = JSON.stringify({
        identifier: target.identifier,
        manifestPath: target.manifestPath,
        schema: 1,
        section: target.section,
        surface: target.surface,
    });
    const digest = createHash('sha256').update(canonical).digest();
    return Object.freeze({
        branchHash: digest.toString('hex').slice(0, 10),
        provisionalTargetId: `pzt1_${digest.toString('base64url').slice(0, 18)}`,
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

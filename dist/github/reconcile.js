import { actionError } from '../errors.js';
import { isCanonicalDigestIdentifier } from '../identifiers.js';
import { canonicalRelativeFile, canonicalRelativeRoot, canonicalZoltManifestPath, canonicalZoltRootLockPath, joinRelativeRoot, } from '../paths.js';
import { managedTargetIdentity } from '../planner/identity.js';
import { parseManagedMarker, } from './managed-marker.js';
import { managedBranch } from './preview.js';
export function reconcileManagedPullRequests(input) {
    requireLimit(input.openPullRequestsLimit);
    requireRepositoryIdentity(input.repositoryId, input.defaultBranch, input.baseSha);
    const desiredById = desiredIndex(input.desired, input.branchGeneration);
    const retainedById = retainedIndex(input.retained ?? [], desiredById);
    const ignored = [];
    const blocked = [];
    const decoded = [];
    for (const existing of [...input.existing].sort(comparePullRequests)) {
        const result = parseManagedMarker(existing.body);
        const localDefaultBranch = existing.headRepositoryId === input.repositoryId
            && existing.baseBranch === input.defaultBranch;
        if (result.kind === 'none') {
            ignored.push(existing);
        }
        else if (result.kind === 'invalid') {
            if (localDefaultBranch && genericManagedBranch(existing.branch)) {
                blocked.push({ existing, reason: result.reason });
            }
            else {
                ignored.push(existing);
            }
        }
        else if (!localDefaultBranch) {
            ignored.push(existing);
        }
        else {
            decoded.push({ existing, marker: result.marker });
        }
    }
    const groups = groupByManagedId(decoded);
    const refresh = [];
    const unchanged = [];
    const close = [];
    const claimedDesired = new Set();
    for (const [managedId, entries] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
        if (desiredById.has(managedId))
            claimedDesired.add(managedId);
        if (entries.length !== 1) {
            for (const entry of entries) {
                blocked.push({
                    existing: entry.existing,
                    reason: `Multiple open pull requests claim managed identity ${managedId}.`,
                });
            }
            continue;
        }
        const entry = entries[0];
        if (entry === undefined)
            continue;
        if (entry.existing.headSha !== entry.marker.managedHeadSha) {
            blocked.push({
                existing: entry.existing,
                reason: 'The managed branch head changed after the action last wrote it.',
            });
            continue;
        }
        const desired = desiredById.get(managedId);
        if (desired === undefined) {
            const retained = retainedById.get(managedId);
            if (retained !== undefined) {
                blocked.push({ existing: entry.existing, reason: retained });
                continue;
            }
            if (!plausibleManagedBranch(entry.existing.branch, entry.marker.managedId, entry.marker.branchGeneration)) {
                blocked.push({
                    existing: entry.existing,
                    reason: 'The obsolete marker is attached to a branch the action does not own.',
                });
                continue;
            }
            close.push(entry.existing);
            continue;
        }
        const mismatch = markerMismatch(entry.marker, desired);
        if (mismatch !== null) {
            blocked.push({ existing: entry.existing, reason: mismatch });
            continue;
        }
        if (entry.existing.branch !== managedBranch(desired.target, entry.marker.branchGeneration)) {
            blocked.push({
                existing: entry.existing,
                reason: 'The managed pull request uses a branch other than the target branch.',
            });
            continue;
        }
        const matched = { desired, existing: entry.existing, marker: entry.marker };
        if (entry.marker.baseSha === input.baseSha
            && entry.marker.targetVersion === desired.target.targetVersion) {
            unchanged.push(matched);
        }
        else {
            refresh.push(matched);
        }
    }
    const unmatched = input.desired.filter(({ target }) => !claimedDesired.has(target.managedId));
    const remainingManagedOpen = refresh.length + unchanged.length + blocked.length;
    const availableSlots = Math.max(0, input.openPullRequestsLimit - remainingManagedOpen);
    return Object.freeze({
        blocked: Object.freeze(blocked.sort(compareBlocked)),
        close: Object.freeze(close.sort(comparePullRequests)),
        create: Object.freeze(unmatched.slice(0, availableSlots)),
        deferred: Object.freeze(unmatched.slice(availableSlots)),
        ignored: Object.freeze(ignored),
        refresh: Object.freeze(refresh.sort(compareMatched)),
        unchanged: Object.freeze(unchanged.sort(compareMatched)),
    });
}
function desiredIndex(desired, branchGeneration) {
    const result = new Map();
    for (const entry of desired) {
        requireDesiredTarget(entry, branchGeneration);
        if (result.has(entry.target.managedId)) {
            throw actionError('ZOLT-RECONCILE-001', `Duplicate desired managed identity ${entry.target.managedId}.`);
        }
        result.set(entry.target.managedId, entry);
    }
    return result;
}
function requireDesiredTarget(entry, branchGeneration) {
    const target = entry.target;
    if (!target.authoritativeTarget
        || !isCanonicalDigestIdentifier(target.targetId, 'zt1_')
        || !isCanonicalDigestIdentifier(target.managedId, 'zud1_')) {
        throw actionError('ZOLT-RECONCILE-001', 'Managed pull request reconciliation requires authoritative schema-v2 targets.');
    }
    const root = canonicalRelativeRoot(target.zoltRoot, 'reconciliation Zolt root');
    const manifest = canonicalZoltManifestPath(target.manifestPath, 'reconciliation manifest path');
    const lockfile = canonicalRelativeFile(target.lockfilePath, 'reconciliation lockfile path');
    const zoltManifestPath = canonicalZoltManifestPath(target.zoltManifestPath, 'reconciliation Zolt manifest path');
    const zoltLockfilePath = canonicalZoltRootLockPath(target.zoltLockfilePath, 'reconciliation Zolt lockfile path');
    if (joinRelativeRoot(root, zoltManifestPath, 'reconciliation manifest path') !== manifest
        || joinRelativeRoot(root, zoltLockfilePath, 'reconciliation lockfile path') !== lockfile) {
        throw actionError('ZOLT-RECONCILE-001', 'The desired target has an inconsistent file boundary.');
    }
    const identity = managedTargetIdentity(root, target.targetId);
    const branch = managedBranch(target, branchGeneration);
    if (identity.managedId !== target.managedId
        || identity.branchHash !== target.branchHash
        || entry.preview.branch !== branch) {
        throw actionError('ZOLT-RECONCILE-001', 'The desired target has an inconsistent managed identity.');
    }
}
function retainedIndex(retained, desired) {
    const result = new Map();
    for (const entry of retained) {
        if (!isCanonicalDigestIdentifier(entry.managedId, 'zud1_') || entry.reason.trim() === '') {
            throw actionError('ZOLT-RECONCILE-001', 'Retained managed targets require a valid identity and reason.');
        }
        if (desired.has(entry.managedId) || result.has(entry.managedId)) {
            throw actionError('ZOLT-RECONCILE-001', `Duplicate reconciliation identity ${entry.managedId}.`);
        }
        result.set(entry.managedId, entry.reason);
    }
    return result;
}
function requireRepositoryIdentity(repositoryId, defaultBranch, baseSha) {
    if (!/^\d+$/u.test(repositoryId) || defaultBranch.trim() === '') {
        throw actionError('ZOLT-RECONCILE-001', 'Repository identity and default branch must be non-empty.');
    }
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(baseSha)) {
        throw actionError('ZOLT-RECONCILE-001', 'The reconciliation base SHA must be a full commit ID.');
    }
}
function groupByManagedId(entries) {
    const grouped = new Map();
    for (const entry of entries) {
        const current = grouped.get(entry.marker.managedId) ?? [];
        current.push(entry);
        grouped.set(entry.marker.managedId, current);
    }
    return grouped;
}
function genericManagedBranch(branch) {
    return /^zolt\/update\/[a-z0-9](?:[a-z0-9-]{0,41}[a-z0-9])?-[0-9a-f]{10}-[0-9a-f]{10}$/u.test(branch);
}
function plausibleManagedBranch(branch, managedId, branchGeneration) {
    if (!isCanonicalDigestIdentifier(managedId, 'zud1_')
        || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(branchGeneration))
        return false;
    const encoded = managedId.slice('zud1_'.length);
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.length !== 32 || bytes.toString('base64url') !== encoded)
        return false;
    const identitySuffix = bytes.toString('hex').slice(0, 10);
    return genericManagedBranch(branch)
        && branch.endsWith(`-${identitySuffix}-${branchGeneration.slice(0, 10)}`);
}
function markerMismatch(marker, desired) {
    const target = desired.target;
    if (marker.targetId !== target.targetId
        || marker.zoltRoot !== target.zoltRoot
        || marker.manifestPath !== target.manifestPath
        || marker.lockfilePath !== target.lockfilePath) {
        return 'The managed marker identity or file boundary no longer matches the target.';
    }
    return null;
}
function comparePullRequests(left, right) {
    return left.number - right.number;
}
function compareBlocked(left, right) {
    return comparePullRequests(left.existing, right.existing);
}
function compareMatched(left, right) {
    return comparePullRequests(left.existing, right.existing);
}
function requireLimit(limit) {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100) {
        throw actionError('ZOLT-RECONCILE-001', 'openPullRequestsLimit must be an integer from 0 through 100.');
    }
}

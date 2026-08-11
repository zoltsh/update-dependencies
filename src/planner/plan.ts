import { posix } from 'node:path';

import { actionError } from '../errors.js';
import type { ActionInputs } from '../inputs.js';
import {
    canonicalRelativeFile,
    canonicalZoltManifestPath,
    canonicalZoltRootLockPath,
    joinRelativeRoot,
} from '../paths.js';
import type {
    BlockedUpdate,
    ChangeClass,
    ExcludedUpdate,
    OutdatedEntry,
    OutdatedEntryV2,
    OutdatedReport,
    OutdatedScope,
    OutdatedScopeV2,
    OutdatedSurface,
    PlannedUpdate,
    UpdatePlan,
    ZoltProjectSelection,
} from '../types.js';
import { managedTargetIdentity, previewTargetId } from './identity.js';

const CLASS_ORDER = new Map<ChangeClass, number>([['patch', 0], ['minor', 1], ['major', 2]]);
const LEGACY_WRITABLE_SURFACES = new Set<OutdatedSurface>([
    'annotationProcessor',
    'dependency',
    'dependencyConstraint',
    'platform',
    'versionAlias',
]);

interface ScopePaths {
    readonly lockfilePath: string;
    readonly manifestPath: string;
    readonly zoltLockfilePath: string;
    readonly zoltManifestPath: string;
}

export function planUpdates(
    report: OutdatedReport,
    selection: ZoltProjectSelection,
    inputs: ActionInputs,
): UpdatePlan {
    const eligible: PlannedUpdate[] = [];
    const blocked: BlockedUpdate[] = [];
    const outsidePolicy: ExcludedUpdate[] = [];
    const seen = new Set<string>();
    const zoltMode = verificationMode(report, selection);

    for (const scope of report.scopes) {
        const paths = scopePaths(report.schemaVersion, selection, scope);
        for (const entry of scope.entries) {
            const authoritative = authoritativeEntry(entry);
            const targetId = authoritative
                ? entry.targetId
                : previewTargetId({
                    identifier: entry.identifier,
                    manifestPath: paths.manifestPath,
                    section: entry.section,
                    surface: entry.surface,
                });
            const base = blockedBase(entry, scope.label, paths.manifestPath, targetId);
            if (entry.status === 'unknown') {
                blocked.push(Object.freeze({ ...base, reason: 'Version discovery was unavailable.' }));
                continue;
            }
            if (entry.status !== 'updateAvailable') continue;
            const blocker = updateBlocker(entry);
            if (blocker !== undefined) {
                blocked.push(Object.freeze({ ...base, reason: blocker }));
                continue;
            }
            const target = selectTarget(entry, inputs.updateCeiling);
            if (target === undefined) {
                outsidePolicy.push(Object.freeze({
                    ...base,
                    reason: `No ${inputs.updateCeiling} target is available.`,
                }));
                continue;
            }
            if (target.version === entry.current) {
                throw actionError('ZOLT-PLAN-001', 'Zolt reported the current version as an available update target.');
            }
            if (seen.has(targetId)) {
                throw actionError('ZOLT-PLAN-002', `Zolt returned duplicate logical update target ${targetId}.`);
            }
            seen.add(targetId);
            eligible.push(Object.freeze({
                authoritativeTarget: authoritative,
                ...managedTargetIdentity(selection.relativeRoot, targetId),
                changeClass: target.changeClass,
                currentVersion: entry.current,
                fanOut: entry.governs,
                identifier: entry.identifier,
                lockfilePath: paths.lockfilePath,
                manifestPath: paths.manifestPath,
                members: entry.members,
                notes: entry.notes,
                scope: scope.label,
                section: entry.section,
                sourceRepository: entry.source,
                surface: entry.surface,
                targetId,
                targetVersion: target.version,
                zoltLockfilePath: paths.zoltLockfilePath,
                zoltManifestPath: paths.zoltManifestPath,
                zoltMode,
                zoltRoot: selection.relativeRoot,
            }));
        }
    }

    eligible.sort(comparePlanned);
    blocked.sort(compareBlocked);
    outsidePolicy.sort(compareBlocked);
    return Object.freeze({
        blocked: Object.freeze(blocked),
        deferred: Object.freeze(eligible.slice(inputs.openPullRequestsLimit)),
        diagnostics: Object.freeze([
            ...report.diagnostics.map((diagnostic) => diagnostic.message),
            ...report.notes,
        ]),
        eligible: Object.freeze(eligible),
        outsidePolicy: Object.freeze(outsidePolicy),
        selected: Object.freeze(eligible.slice(0, inputs.openPullRequestsLimit)),
    });
}


function verificationMode(
    report: OutdatedReport,
    selection: ZoltProjectSelection,
): 'project' | 'workspace' {
    if (selection.mode === 'project' || report.schemaVersion === 1) return selection.mode;
    const onlyScope = report.scopes.length === 1 ? report.scopes[0] as OutdatedScopeV2 | undefined : undefined;
    if (
        onlyScope !== undefined
        && onlyScope.manifestPath === 'zolt.toml'
        && onlyScope.label !== '.'
    ) {
        return 'project';
    }
    return 'workspace';
}

function selectTarget(
    entry: OutdatedEntry,
    ceiling: ActionInputs['updateCeiling'],
): { readonly changeClass: ChangeClass; readonly version: string } | undefined {
    if (ceiling === 'patch') {
        return entry.candidates.patch === null
            ? undefined
            : { changeClass: 'patch', version: entry.candidates.patch };
    }
    if (ceiling === 'minor') return paired(entry.selectedInMajor, entry.selectedInMajorClass, 'selectedInMajor');
    return paired(entry.selectedLatest, entry.selectedLatestClass, 'selectedLatest');
}

function paired(
    version: string | null,
    changeClass: ChangeClass | null,
    label: string,
): { readonly changeClass: ChangeClass; readonly version: string } | undefined {
    if (version === null && changeClass === null) return undefined;
    if (version === null || changeClass === null) {
        throw actionError('ZOLT-PLAN-003', `Zolt returned inconsistent ${label} fields.`);
    }
    return { changeClass, version };
}

function scopePaths(
    schemaVersion: 1 | 2,
    selection: ZoltProjectSelection,
    scope: OutdatedScope,
): ScopePaths {
    if (schemaVersion === 2) return v2ScopePaths(selection, scope as OutdatedScopeV2);
    const zoltManifestPath = legacyManifestForScope(selection, scope.label);
    const zoltLockfilePath = 'zolt.lock';
    return {
        lockfilePath: joinRelativeRoot(selection.relativeRoot, zoltLockfilePath, 'legacy lockfile path'),
        manifestPath: joinRelativeRoot(selection.relativeRoot, zoltManifestPath, 'legacy manifest path'),
        zoltLockfilePath,
        zoltManifestPath,
    };
}

function v2ScopePaths(selection: ZoltProjectSelection, scope: OutdatedScopeV2): ScopePaths {
    const zoltManifestPath = canonicalZoltManifestPath(scope.manifestPath, 'Zolt manifest path');
    const zoltLockfilePath = canonicalZoltRootLockPath(scope.lockfilePath, 'Zolt lockfile path');
    if (selection.mode === 'project' && zoltManifestPath !== 'zolt.toml') {
        throw actionError(
            'ZOLT-PLAN-005',
            `Standalone Zolt reported manifest ${zoltManifestPath}; expected zolt.toml.`,
        );
    }
    const manifestPath = joinRelativeRoot(selection.relativeRoot, zoltManifestPath, 'Zolt manifest path');
    const lockfilePath = joinRelativeRoot(selection.relativeRoot, zoltLockfilePath, 'Zolt lockfile path');
    if (lockfilePath !== selection.lockfilePath) {
        throw actionError(
            'ZOLT-PLAN-005',
            `Zolt reported lockfile ${lockfilePath}, but project selection requires ${selection.lockfilePath}.`,
        );
    }
    return {
        lockfilePath,
        manifestPath,
        zoltLockfilePath,
        zoltManifestPath,
    };
}

function legacyManifestForScope(selection: ZoltProjectSelection, label: string): string {
    if (selection.mode === 'project') return 'zolt.toml';
    if (
        label === ''
        || label.includes('\\')
        || label.includes('\0')
        || label.startsWith('/')
        || /[\u0000-\u001F\u007F]/u.test(label)
    ) {
        throw actionError('ZOLT-PLAN-004', `Workspace scope label is not a safe member path: ${JSON.stringify(label)}.`);
    }
    const normalized = posix.normalize(label);
    if (normalized !== label || normalized === '..' || normalized.startsWith('../')) {
        throw actionError('ZOLT-PLAN-004', `Workspace scope label is not a safe member path: ${JSON.stringify(label)}.`);
    }
    const member = normalized === '.' ? '' : normalized;
    return canonicalRelativeFile(posix.join(member, 'zolt.toml'), 'legacy workspace manifest path');
}

function authoritativeEntry(entry: OutdatedEntry): entry is OutdatedEntryV2 {
    return 'targetId' in entry;
}

function updateBlocker(entry: OutdatedEntry): string | undefined {
    if (authoritativeEntry(entry)) {
        return entry.updateable ? undefined : entry.updateBlocker ?? 'Zolt cannot update this target.';
    }
    return LEGACY_WRITABLE_SURFACES.has(entry.surface)
        ? undefined
        : 'The pinned Zolt update command cannot mutate this literal generated-tool surface.';
}

function blockedBase(
    entry: OutdatedEntry,
    scope: string,
    manifestPath: string,
    targetId: string,
): Omit<BlockedUpdate, 'reason'> {
    return {
        currentVersion: entry.current,
        identifier: entry.identifier,
        manifestPath,
        notes: entry.notes,
        scope,
        section: entry.section,
        surface: entry.surface,
        targetId,
    };
}

function comparePlanned(left: PlannedUpdate, right: PlannedUpdate): number {
    return (CLASS_ORDER.get(left.changeClass) ?? 99) - (CLASS_ORDER.get(right.changeClass) ?? 99)
        || left.manifestPath.localeCompare(right.manifestPath)
        || left.targetId.localeCompare(right.targetId);
}

function compareBlocked(left: BlockedUpdate, right: BlockedUpdate): number {
    return left.manifestPath.localeCompare(right.manifestPath)
        || left.surface.localeCompare(right.surface)
        || left.identifier.localeCompare(right.identifier)
        || left.section.localeCompare(right.section);
}

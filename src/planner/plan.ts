import { posix } from 'node:path';

import { actionError } from '../errors.js';
import type { ActionInputs } from '../inputs.js';
import type {
    BlockedUpdate,
    ChangeClass,
    ExcludedUpdate,
    OutdatedEntry,
    OutdatedReport,
    OutdatedSurface,
    PlannedUpdate,
    UpdatePlan,
    ZoltProjectSelection,
} from '../types.js';
import { previewTargetIdentity } from './identity.js';

const CLASS_ORDER = new Map<ChangeClass, number>([['patch', 0], ['minor', 1], ['major', 2]]);
const WRITABLE_SURFACES = new Set<OutdatedSurface>([
    'annotationProcessor',
    'dependency',
    'dependencyConstraint',
    'platform',
    'versionAlias',
]);

export function planUpdates(
    report: OutdatedReport,
    selection: ZoltProjectSelection,
    inputs: ActionInputs,
): UpdatePlan {
    const eligible: PlannedUpdate[] = [];
    const blocked: BlockedUpdate[] = [];
    const outsidePolicy: ExcludedUpdate[] = [];
    const seen = new Set<string>();

    for (const scope of report.scopes) {
        const manifestPath = manifestForScope(selection, scope.label);
        for (const entry of scope.entries) {
            const base = {
                currentVersion: entry.current,
                identifier: entry.identifier,
                manifestPath,
                notes: entry.notes,
                scope: scope.label,
                section: entry.section,
                surface: entry.surface,
            } as const;
            if (entry.status === 'unknown') {
                blocked.push(Object.freeze({ ...base, reason: 'Version discovery was unavailable.' }));
                continue;
            }
            if (entry.status !== 'updateAvailable') continue;
            if (!WRITABLE_SURFACES.has(entry.surface)) {
                blocked.push(Object.freeze({
                    ...base,
                    reason: 'The current Zolt update command cannot mutate this literal generated-tool surface.',
                }));
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
            const identity = previewTargetIdentity({
                identifier: entry.identifier,
                manifestPath,
                section: entry.section,
                surface: entry.surface,
            });
            if (seen.has(identity.provisionalTargetId)) {
                throw actionError(
                    'ZOLT-PLAN-002',
                    `Zolt returned duplicate logical update target ${identity.provisionalTargetId}.`,
                );
            }
            seen.add(identity.provisionalTargetId);
            eligible.push(Object.freeze({
                ...identity,
                changeClass: target.changeClass,
                currentVersion: entry.current,
                fanOut: entry.governs,
                identifier: entry.identifier,
                lockfilePath: selection.lockfilePath,
                manifestPath,
                members: entry.members,
                notes: entry.notes,
                scope: scope.label,
                section: entry.section,
                sourceRepository: entry.source,
                surface: entry.surface,
                targetVersion: target.version,
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

function manifestForScope(selection: ZoltProjectSelection, label: string): string {
    if (selection.mode === 'project') return selection.manifestPath;
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
    const workspaceRoot = selection.relativeRoot === '.' ? '' : selection.relativeRoot;
    const member = normalized === '.' ? '' : normalized;
    return posix.join(workspaceRoot, member, 'zolt.toml');
}

function comparePlanned(left: PlannedUpdate, right: PlannedUpdate): number {
    return (CLASS_ORDER.get(left.changeClass) ?? 99) - (CLASS_ORDER.get(right.changeClass) ?? 99)
        || left.manifestPath.localeCompare(right.manifestPath)
        || left.provisionalTargetId.localeCompare(right.provisionalTargetId);
}

function compareBlocked(left: BlockedUpdate, right: BlockedUpdate): number {
    return left.manifestPath.localeCompare(right.manifestPath)
        || left.surface.localeCompare(right.surface)
        || left.identifier.localeCompare(right.identifier)
        || left.section.localeCompare(right.section);
}

import { isCanonicalDigestIdentifier } from '../identifiers.js';
import { canonicalZoltManifestPath, canonicalZoltRootLockPath } from '../paths.js';
import type {
    ChangeClass,
    OutdatedCandidates,
    OutdatedEntryV2,
    OutdatedReportV2,
    OutdatedScopeV2,
    OutdatedStatus,
    OutdatedSurface,
} from '../types.js';
import {
    booleanValue,
    boundedArray,
    contractError,
    decodeDiagnostic,
    enumString,
    exactObject,
    literal,
    nonEmptyString,
    nullableEnum,
    nullableString,
    parseMachineDocument,
    stringArray,
} from './contract-values.js';

const SURFACES = new Set<OutdatedSurface>([
    'annotationProcessor',
    'dependency',
    'dependencyConstraint',
    'execToolCoordinate',
    'openapiTool',
    'platform',
    'protobufTool',
    'versionAlias',
]);
const CHANGE_CLASSES = new Set<ChangeClass>(['major', 'minor', 'patch']);
const RAW_STATUSES = new Set(['current', 'unknown', 'update-available'] as const);
const WARNING = new Set(['warning'] as const);
const MAX_SCOPES = 10_000;
const MAX_ENTRIES = 100_000;

export function decodeOutdatedReportV2(document: string): OutdatedReportV2 {
    const root = exactObject(parseMachineDocument(document, 'Zolt outdated'), 'outdated', [
        'command',
        'diagnostics',
        'notes',
        'schemaVersion',
        'scopes',
        'status',
    ]);
    literal(root.schemaVersion, 2, 'schemaVersion');
    literal(root.command, 'outdated', 'command');
    literal(root.status, 'ok', 'status');
    const rawScopes = boundedArray(root.scopes, 'scopes', MAX_SCOPES);
    let totalEntries = 0;
    const scopes = rawScopes.map((value, index) => {
        const scope = decodeScope(value, index);
        totalEntries += scope.entries.length;
        if (totalEntries > MAX_ENTRIES) {
            throw contractError('Zolt outdated JSON contains too many entries.');
        }
        return scope;
    });
    validateUniqueInventory(scopes);
    return Object.freeze({
        command: 'outdated',
        diagnostics: Object.freeze(boundedArray(root.diagnostics, 'diagnostics', 10_000)
            .map((value, index) => decodeDiagnostic(value, index, WARNING))),
        notes: stringArray(root.notes, 'notes', MAX_ENTRIES),
        schemaVersion: 2,
        scopes: Object.freeze(scopes),
        status: 'ok',
    });
}

function validateUniqueInventory(scopes: readonly OutdatedScopeV2[]): void {
    const manifests = new Set<string>();
    const targets = new Set<string>();
    for (const scope of scopes) {
        if (manifests.has(scope.manifestPath)) {
            throw contractError(`Zolt outdated JSON repeats manifest scope ${scope.manifestPath}.`);
        }
        manifests.add(scope.manifestPath);
        for (const entry of scope.entries) {
            if (targets.has(entry.targetId)) {
                throw contractError(`Zolt outdated JSON repeats target ID ${entry.targetId}.`);
            }
            targets.add(entry.targetId);
        }
    }
}

export function decodeTargetId(value: unknown, label: string): string {
    const rendered = nonEmptyString(value, label);
    if (!isCanonicalDigestIdentifier(rendered, 'zt1_')) {
        throw contractError(`${label} must be a canonical zt1_ target ID.`);
    }
    return rendered;
}

function decodeScope(value: unknown, index: number): OutdatedScopeV2 {
    const label = `scopes[${index.toString()}]`;
    const scope = exactObject(value, label, ['entries', 'label', 'lockfilePath', 'manifestPath']);
    return Object.freeze({
        entries: Object.freeze(boundedArray(scope.entries, `${label}.entries`, MAX_ENTRIES)
            .map((entry, entryIndex) => decodeEntry(entry, index, entryIndex))),
        label: nonEmptyString(scope.label, `${label}.label`),
        lockfilePath: canonicalZoltRootLockPath(
            nonEmptyString(scope.lockfilePath, `${label}.lockfilePath`),
            `${label}.lockfilePath`,
        ),
        manifestPath: canonicalZoltManifestPath(
            nonEmptyString(scope.manifestPath, `${label}.manifestPath`),
            `${label}.manifestPath`,
        ),
    });
}

function decodeEntry(value: unknown, scopeIndex: number, entryIndex: number): OutdatedEntryV2 {
    const label = `scopes[${scopeIndex.toString()}].entries[${entryIndex.toString()}]`;
    const entry = exactObject(value, label, [
        'candidates',
        'current',
        'governs',
        'identifier',
        'members',
        'notes',
        'section',
        'selectedInMajor',
        'selectedInMajorClass',
        'selectedLatest',
        'selectedLatestClass',
        'source',
        'status',
        'surface',
        'targetId',
        'updateBlocker',
        'updateable',
    ]);
    const candidates = exactObject(entry.candidates, `${label}.candidates`, ['major', 'minor', 'patch']);
    const updateable = booleanValue(entry.updateable, `${label}.updateable`);
    const updateBlocker = nullableString(entry.updateBlocker, `${label}.updateBlocker`);
    if (updateable && updateBlocker !== null) {
        throw contractError(`${label}.updateBlocker must be null for an updateable target.`);
    }
    if (!updateable && updateBlocker === null) {
        throw contractError(`${label}.updateBlocker must explain why the target is not updateable.`);
    }
    return Object.freeze({
        candidates: decodeCandidates(candidates, `${label}.candidates`),
        current: nonEmptyString(entry.current, `${label}.current`),
        governs: stringArray(entry.governs, `${label}.governs`, MAX_ENTRIES),
        identifier: nonEmptyString(entry.identifier, `${label}.identifier`),
        members: stringArray(entry.members, `${label}.members`, MAX_ENTRIES),
        notes: stringArray(entry.notes, `${label}.notes`, MAX_ENTRIES),
        section: nonEmptyString(entry.section, `${label}.section`),
        selectedInMajor: nullableString(entry.selectedInMajor, `${label}.selectedInMajor`),
        selectedInMajorClass: nullableEnum(
            entry.selectedInMajorClass,
            CHANGE_CLASSES,
            `${label}.selectedInMajorClass`,
        ),
        selectedLatest: nullableString(entry.selectedLatest, `${label}.selectedLatest`),
        selectedLatestClass: nullableEnum(
            entry.selectedLatestClass,
            CHANGE_CLASSES,
            `${label}.selectedLatestClass`,
        ),
        source: nullableString(entry.source, `${label}.source`),
        status: normalizeStatus(enumString(entry.status, RAW_STATUSES, `${label}.status`)),
        surface: enumString(entry.surface, SURFACES, `${label}.surface`),
        targetId: decodeTargetId(entry.targetId, `${label}.targetId`),
        updateable,
        updateBlocker,
    });
}

function normalizeStatus(value: 'current' | 'unknown' | 'update-available'): OutdatedStatus {
    return value === 'update-available' ? 'updateAvailable' : value;
}

function decodeCandidates(value: Record<string, unknown>, label: string): OutdatedCandidates {
    return Object.freeze({
        major: nullableString(value.major, `${label}.major`),
        minor: nullableString(value.minor, `${label}.minor`),
        patch: nullableString(value.patch, `${label}.patch`),
    });
}

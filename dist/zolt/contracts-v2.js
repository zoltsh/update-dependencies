import { isCanonicalDigestIdentifier } from '../identifiers.js';
import { canonicalZoltManifestPath, canonicalZoltRootLockPath } from '../paths.js';
import { canonicalTargetText, requireMatchingZoltTargetId } from './target-id.js';
import { booleanValue, boundedArray, contractError, decodeDiagnostic, enumString, exactObject, literal, nonEmptyString, nullableEnum, nullableString, parseMachineDocument, stringArray, } from './contract-values.js';
const SURFACES = new Set([
    'annotationProcessor',
    'dependency',
    'dependencyConstraint',
    'execToolCoordinate',
    'openapiTool',
    'platform',
    'protobufTool',
    'versionAlias',
]);
const CHANGE_CLASSES = new Set(['major', 'minor', 'patch']);
const MUTABLE_SURFACES = new Set([
    'annotationProcessor',
    'dependency',
    'dependencyConstraint',
    'platform',
    'versionAlias',
]);
const RAW_STATUSES = new Set(['current', 'unknown', 'update-available']);
const WARNING = new Set(['warning']);
const MAX_SCOPES = 10_000;
const MAX_ENTRIES = 100_000;
export function decodeOutdatedReportV2(document) {
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
function validateUniqueInventory(scopes) {
    const manifests = new Set();
    const targets = new Set();
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
export function decodeTargetId(value, label) {
    const rendered = nonEmptyString(value, label);
    if (!isCanonicalDigestIdentifier(rendered, 'zt1_')) {
        throw contractError(`${label} must be a canonical zt1_ target ID.`);
    }
    return rendered;
}
function decodeScope(value, index) {
    const label = `scopes[${index.toString()}]`;
    const scope = exactObject(value, label, ['entries', 'label', 'lockfilePath', 'manifestPath']);
    const manifestPath = canonicalZoltManifestPath(nonEmptyString(scope.manifestPath, `${label}.manifestPath`), `${label}.manifestPath`);
    return Object.freeze({
        entries: Object.freeze(boundedArray(scope.entries, `${label}.entries`, MAX_ENTRIES)
            .map((entry, entryIndex) => decodeEntry(entry, index, entryIndex, manifestPath))),
        label: nonEmptyString(scope.label, `${label}.label`),
        lockfilePath: canonicalZoltRootLockPath(nonEmptyString(scope.lockfilePath, `${label}.lockfilePath`), `${label}.lockfilePath`),
        manifestPath,
    });
}
function decodeEntry(value, scopeIndex, entryIndex, manifestPath) {
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
    const surface = enumString(entry.surface, SURFACES, `${label}.surface`);
    const identifier = canonicalTargetText(nonEmptyString(entry.identifier, `${label}.identifier`), `${label}.identifier`);
    const section = canonicalTargetText(nonEmptyString(entry.section, `${label}.section`), `${label}.section`);
    const updateable = booleanValue(entry.updateable, `${label}.updateable`);
    const updateBlocker = nullableString(entry.updateBlocker, `${label}.updateBlocker`);
    if (updateable && updateBlocker !== null) {
        throw contractError(`${label}.updateBlocker must be null for an updateable target.`);
    }
    if (!updateable && updateBlocker === null) {
        throw contractError(`${label}.updateBlocker must explain why the target is not updateable.`);
    }
    if (updateable !== MUTABLE_SURFACES.has(surface)) {
        throw contractError(`${label}.updateable does not match the mutability of ${surface}.`);
    }
    const targetId = requireMatchingZoltTargetId(decodeTargetId(entry.targetId, `${label}.targetId`), { identifier, manifestPath, section, surface }, `${label}.targetId`);
    return Object.freeze({
        candidates: decodeCandidates(candidates, `${label}.candidates`),
        current: nonEmptyString(entry.current, `${label}.current`),
        governs: stringArray(entry.governs, `${label}.governs`, MAX_ENTRIES),
        identifier,
        members: stringArray(entry.members, `${label}.members`, MAX_ENTRIES),
        notes: stringArray(entry.notes, `${label}.notes`, MAX_ENTRIES),
        section,
        selectedInMajor: nullableString(entry.selectedInMajor, `${label}.selectedInMajor`),
        selectedInMajorClass: nullableEnum(entry.selectedInMajorClass, CHANGE_CLASSES, `${label}.selectedInMajorClass`),
        selectedLatest: nullableString(entry.selectedLatest, `${label}.selectedLatest`),
        selectedLatestClass: nullableEnum(entry.selectedLatestClass, CHANGE_CLASSES, `${label}.selectedLatestClass`),
        source: nullableString(entry.source, `${label}.source`),
        status: normalizeStatus(enumString(entry.status, RAW_STATUSES, `${label}.status`)),
        surface,
        targetId,
        updateable,
        updateBlocker,
    });
}
function normalizeStatus(value) {
    return value === 'update-available' ? 'updateAvailable' : value;
}
function decodeCandidates(value, label) {
    return Object.freeze({
        major: nullableString(value.major, `${label}.major`),
        minor: nullableString(value.minor, `${label}.minor`),
        patch: nullableString(value.patch, `${label}.patch`),
    });
}

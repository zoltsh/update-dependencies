import { boundedArray, contractError, decodeDiagnostic, enumString, exactObject, literal, nonEmptyString, nullableEnum, nullableString, parseMachineDocument, stringArray, } from './contract-values.js';
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
const RAW_STATUSES = new Set(['current', 'unknown', 'update-available']);
const WARNING = new Set(['warning']);
const MAX_SCOPES = 10_000;
const MAX_ENTRIES = 100_000;
export function decodeOutdatedReport(document) {
    const root = exactObject(parseMachineDocument(document, 'Zolt outdated'), 'outdated', [
        'command',
        'diagnostics',
        'notes',
        'schemaVersion',
        'scopes',
        'status',
    ]);
    literal(root.schemaVersion, 1, 'schemaVersion');
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
    return Object.freeze({
        command: 'outdated',
        diagnostics: Object.freeze(boundedArray(root.diagnostics, 'diagnostics', 10_000)
            .map((value, index) => decodeDiagnostic(value, index, WARNING))),
        notes: stringArray(root.notes, 'notes', MAX_ENTRIES),
        schemaVersion: 1,
        scopes: Object.freeze(scopes),
        status: 'ok',
    });
}
function decodeScope(value, index) {
    const label = `scopes[${index.toString()}]`;
    const scope = exactObject(value, label, ['entries', 'label']);
    return Object.freeze({
        entries: Object.freeze(boundedArray(scope.entries, `${label}.entries`, MAX_ENTRIES)
            .map((entry, entryIndex) => decodeEntry(entry, index, entryIndex))),
        label: nonEmptyString(scope.label, `${label}.label`),
    });
}
function decodeEntry(value, scopeIndex, entryIndex) {
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
    ]);
    const candidates = exactObject(entry.candidates, `${label}.candidates`, ['major', 'minor', 'patch']);
    return Object.freeze({
        candidates: decodeCandidates(candidates, `${label}.candidates`),
        current: nonEmptyString(entry.current, `${label}.current`),
        governs: stringArray(entry.governs, `${label}.governs`, MAX_ENTRIES),
        identifier: nonEmptyString(entry.identifier, `${label}.identifier`),
        members: stringArray(entry.members, `${label}.members`, MAX_ENTRIES),
        notes: stringArray(entry.notes, `${label}.notes`, MAX_ENTRIES),
        section: nonEmptyString(entry.section, `${label}.section`),
        selectedInMajor: nullableString(entry.selectedInMajor, `${label}.selectedInMajor`),
        selectedInMajorClass: nullableEnum(entry.selectedInMajorClass, CHANGE_CLASSES, `${label}.selectedInMajorClass`),
        selectedLatest: nullableString(entry.selectedLatest, `${label}.selectedLatest`),
        selectedLatestClass: nullableEnum(entry.selectedLatestClass, CHANGE_CLASSES, `${label}.selectedLatestClass`),
        source: nullableString(entry.source, `${label}.source`),
        status: normalizeStatus(enumString(entry.status, RAW_STATUSES, `${label}.status`)),
        surface: enumString(entry.surface, SURFACES, `${label}.surface`),
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

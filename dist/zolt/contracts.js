import { MAX_MACHINE_OUTPUT_BYTES } from '../constants.js';
import { actionError } from '../errors.js';
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
const MAX_SCOPES = 10_000;
const MAX_ENTRIES = 100_000;
export function decodeOutdatedReport(document) {
    if (Buffer.byteLength(document, 'utf8') > MAX_MACHINE_OUTPUT_BYTES) {
        throw contractError('Zolt outdated JSON exceeds the machine-output byte limit.');
    }
    let parsed;
    try {
        parsed = JSON.parse(document);
    }
    catch (error) {
        throw contractError('Zolt outdated output is not valid JSON.', error);
    }
    const root = exactObject(parsed, 'outdated', [
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
    const rawScopes = array(root.scopes, 'scopes', MAX_SCOPES);
    let totalEntries = 0;
    const scopes = rawScopes.map((value, index) => {
        const scope = decodeScope(value, index);
        totalEntries += scope.entries.length;
        if (totalEntries > MAX_ENTRIES)
            throw contractError('Zolt outdated JSON contains too many entries.');
        return scope;
    });
    return Object.freeze({
        command: 'outdated',
        diagnostics: Object.freeze(array(root.diagnostics, 'diagnostics', 10_000).map(decodeDiagnostic)),
        notes: Object.freeze(stringArray(root.notes, 'notes')),
        schemaVersion: 1,
        scopes: Object.freeze(scopes),
        status: 'ok',
    });
}
function decodeScope(value, index) {
    const label = `scopes[${index.toString()}]`;
    const scope = exactObject(value, label, ['entries', 'label']);
    return Object.freeze({
        entries: Object.freeze(array(scope.entries, `${label}.entries`, MAX_ENTRIES)
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
        governs: Object.freeze(stringArray(entry.governs, `${label}.governs`)),
        identifier: nonEmptyString(entry.identifier, `${label}.identifier`),
        members: Object.freeze(stringArray(entry.members, `${label}.members`)),
        notes: Object.freeze(stringArray(entry.notes, `${label}.notes`)),
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
function decodeDiagnostic(value, index) {
    const label = `diagnostics[${index.toString()}]`;
    const diagnostic = exactObject(value, label, ['message', 'severity']);
    literal(diagnostic.severity, 'warning', `${label}.severity`);
    return Object.freeze({
        message: nonEmptyString(diagnostic.message, `${label}.message`),
        severity: 'warning',
    });
}
function exactObject(value, label, expectedKeys) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw contractError(`${label} must be an object.`);
    }
    const result = value;
    const actual = Object.keys(result).sort();
    const expected = [...expectedKeys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw contractError(`${label} has unknown or missing fields.`);
    }
    return result;
}
function array(value, label, maximum) {
    if (!Array.isArray(value) || value.length > maximum) {
        throw contractError(`${label} must be a bounded array.`);
    }
    return value;
}
function stringArray(value, label) {
    return array(value, label, MAX_ENTRIES)
        .map((entry, index) => nonEmptyString(entry, `${label}[${index.toString()}]`));
}
function nonEmptyString(value, label) {
    if (typeof value !== 'string'
        || value === ''
        || value.length > 64 * 1024
        || /[\u0000-\u001F\u007F]/u.test(value)) {
        throw contractError(`${label} must be a bounded non-empty string.`);
    }
    return value;
}
function nullableString(value, label) {
    return value === null ? null : nonEmptyString(value, label);
}
function enumString(value, allowed, label) {
    const rendered = nonEmptyString(value, label);
    if (!allowed.has(rendered)) {
        throw contractError(`${label} has unsupported value ${rendered}.`);
    }
    return rendered;
}
function nullableEnum(value, allowed, label) {
    return value === null ? null : enumString(value, allowed, label);
}
function literal(value, expected, label) {
    if (value !== expected)
        throw contractError(`${label} must equal ${String(expected)}.`);
}
function contractError(message, cause) {
    return actionError('ZOLT-CONTRACT-001', message, cause);
}

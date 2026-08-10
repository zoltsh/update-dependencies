import { MAX_MACHINE_OUTPUT_BYTES } from '../constants.js';
import { actionError } from '../errors.js';
import type {
    ChangeClass,
    Diagnostic,
    OutdatedCandidates,
    OutdatedEntry,
    OutdatedReport,
    OutdatedScope,
    OutdatedStatus,
    OutdatedSurface,
} from '../types.js';

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
const MAX_SCOPES = 10_000;
const MAX_ENTRIES = 100_000;

export function decodeOutdatedReport(document: string): OutdatedReport {
    if (Buffer.byteLength(document, 'utf8') > MAX_MACHINE_OUTPUT_BYTES) {
        throw contractError('Zolt outdated JSON exceeds the machine-output byte limit.');
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(document) as unknown;
    } catch (error) {
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
        if (totalEntries > MAX_ENTRIES) throw contractError('Zolt outdated JSON contains too many entries.');
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

function decodeScope(value: unknown, index: number): OutdatedScope {
    const label = `scopes[${index.toString()}]`;
    const scope = exactObject(value, label, ['entries', 'label']);
    return Object.freeze({
        entries: Object.freeze(array(scope.entries, `${label}.entries`, MAX_ENTRIES)
            .map((entry, entryIndex) => decodeEntry(entry, index, entryIndex))),
        label: nonEmptyString(scope.label, `${label}.label`),
    });
}

function decodeEntry(value: unknown, scopeIndex: number, entryIndex: number): OutdatedEntry {
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

function decodeDiagnostic(value: unknown, index: number): Diagnostic {
    const label = `diagnostics[${index.toString()}]`;
    const diagnostic = exactObject(value, label, ['message', 'severity']);
    literal(diagnostic.severity, 'warning', `${label}.severity`);
    return Object.freeze({
        message: nonEmptyString(diagnostic.message, `${label}.message`),
        severity: 'warning',
    });
}


function exactObject(value: unknown, label: string, expectedKeys: readonly string[]): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw contractError(`${label} must be an object.`);
    }
    const result = value as Record<string, unknown>;
    const actual = Object.keys(result).sort();
    const expected = [...expectedKeys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw contractError(`${label} has unknown or missing fields.`);
    }
    return result;
}

function array(value: unknown, label: string, maximum: number): readonly unknown[] {
    if (!Array.isArray(value) || value.length > maximum) {
        throw contractError(`${label} must be a bounded array.`);
    }
    return value;
}

function stringArray(value: unknown, label: string): string[] {
    return array(value, label, MAX_ENTRIES)
        .map((entry, index) => nonEmptyString(entry, `${label}[${index.toString()}]`));
}

function nonEmptyString(value: unknown, label: string): string {
    if (
        typeof value !== 'string'
        || value === ''
        || value.length > 64 * 1024
        || /[\u0000-\u001F\u007F]/u.test(value)
    ) {
        throw contractError(`${label} must be a bounded non-empty string.`);
    }
    return value;
}

function nullableString(value: unknown, label: string): string | null {
    return value === null ? null : nonEmptyString(value, label);
}

function enumString<Value extends string>(
    value: unknown,
    allowed: ReadonlySet<Value>,
    label: string,
): Value {
    const rendered = nonEmptyString(value, label);
    if (!allowed.has(rendered as Value)) {
        throw contractError(`${label} has unsupported value ${rendered}.`);
    }
    return rendered as Value;
}

function nullableEnum<Value extends string>(
    value: unknown,
    allowed: ReadonlySet<Value>,
    label: string,
): Value | null {
    return value === null ? null : enumString(value, allowed, label);
}

function literal(value: unknown, expected: string | number, label: string): void {
    if (value !== expected) throw contractError(`${label} must equal ${String(expected)}.`);
}

function contractError(message: string, cause?: unknown): ReturnType<typeof actionError> {
    return actionError('ZOLT-CONTRACT-001', message, cause);
}

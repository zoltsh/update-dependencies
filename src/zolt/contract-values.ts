import { MAX_MACHINE_OUTPUT_BYTES } from '../constants.js';
import { actionError } from '../errors.js';
import type { Diagnostic } from '../types.js';

const CONTROL = /[\u0000-\u001F\u007F]/u;

export function parseMachineDocument(document: string, label: string): unknown {
    if (Buffer.byteLength(document, 'utf8') > MAX_MACHINE_OUTPUT_BYTES) {
        throw contractError(`${label} JSON exceeds the machine-output byte limit.`);
    }
    try {
        return JSON.parse(document) as unknown;
    } catch (error) {
        throw contractError(`${label} output is not valid JSON.`, error);
    }
}

export function exactObject(
    value: unknown,
    label: string,
    expectedKeys: readonly string[],
): Record<string, unknown> {
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

export function boundedArray(value: unknown, label: string, maximum: number): readonly unknown[] {
    if (!Array.isArray(value) || value.length > maximum) {
        throw contractError(`${label} must be a bounded array.`);
    }
    return value;
}

export function stringArray(value: unknown, label: string, maximum: number): readonly string[] {
    return Object.freeze(boundedArray(value, label, maximum)
        .map((entry, index) => nonEmptyString(entry, `${label}[${index.toString()}]`)));
}

export function nonEmptyString(value: unknown, label: string): string {
    if (
        typeof value !== 'string'
        || value === ''
        || value.length > 64 * 1024
        || CONTROL.test(value)
    ) {
        throw contractError(`${label} must be a bounded non-empty string.`);
    }
    return value;
}

export function nullableString(value: unknown, label: string): string | null {
    return value === null ? null : nonEmptyString(value, label);
}

export function booleanValue(value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') throw contractError(`${label} must be a boolean.`);
    return value;
}

export function enumString<Value extends string>(
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

export function nullableEnum<Value extends string>(
    value: unknown,
    allowed: ReadonlySet<Value>,
    label: string,
): Value | null {
    return value === null ? null : enumString(value, allowed, label);
}

export function literal(value: unknown, expected: string | number | boolean, label: string): void {
    if (value !== expected) throw contractError(`${label} must equal ${String(expected)}.`);
}

export function decodeDiagnostic(
    value: unknown,
    index: number,
    allowedSeverities: ReadonlySet<Diagnostic['severity']>,
): Diagnostic {
    const label = `diagnostics[${index.toString()}]`;
    const diagnostic = exactObject(value, label, ['message', 'severity']);
    return Object.freeze({
        message: nonEmptyString(diagnostic.message, `${label}.message`),
        severity: enumString(diagnostic.severity, allowedSeverities, `${label}.severity`),
    });
}

export function contractError(message: string, cause?: unknown): ReturnType<typeof actionError> {
    return actionError('ZOLT-CONTRACT-001', message, cause);
}

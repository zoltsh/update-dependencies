import { MAX_MACHINE_OUTPUT_BYTES } from '../constants.js';
import { actionError } from '../errors.js';
const CONTROL = /[\u0000-\u001F\u007F]/u;
export function parseMachineDocument(document, label) {
    if (Buffer.byteLength(document, 'utf8') > MAX_MACHINE_OUTPUT_BYTES) {
        throw contractError(`${label} JSON exceeds the machine-output byte limit.`);
    }
    try {
        return JSON.parse(document);
    }
    catch (error) {
        throw contractError(`${label} output is not valid JSON.`, error);
    }
}
export function exactObject(value, label, expectedKeys) {
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
export function boundedArray(value, label, maximum) {
    if (!Array.isArray(value) || value.length > maximum) {
        throw contractError(`${label} must be a bounded array.`);
    }
    return value;
}
export function stringArray(value, label, maximum) {
    return Object.freeze(boundedArray(value, label, maximum)
        .map((entry, index) => nonEmptyString(entry, `${label}[${index.toString()}]`)));
}
export function nonEmptyString(value, label) {
    if (typeof value !== 'string'
        || value === ''
        || value.length > 64 * 1024
        || CONTROL.test(value)) {
        throw contractError(`${label} must be a bounded non-empty string.`);
    }
    return value;
}
export function nullableString(value, label) {
    return value === null ? null : nonEmptyString(value, label);
}
export function booleanValue(value, label) {
    if (typeof value !== 'boolean')
        throw contractError(`${label} must be a boolean.`);
    return value;
}
export function enumString(value, allowed, label) {
    const rendered = nonEmptyString(value, label);
    if (!allowed.has(rendered)) {
        throw contractError(`${label} has unsupported value ${rendered}.`);
    }
    return rendered;
}
export function nullableEnum(value, allowed, label) {
    return value === null ? null : enumString(value, allowed, label);
}
export function literal(value, expected, label) {
    if (value !== expected)
        throw contractError(`${label} must equal ${String(expected)}.`);
}
export function decodeDiagnostic(value, index, allowedSeverities) {
    const label = `diagnostics[${index.toString()}]`;
    const diagnostic = exactObject(value, label, ['message', 'severity']);
    return Object.freeze({
        message: nonEmptyString(diagnostic.message, `${label}.message`),
        severity: enumString(diagnostic.severity, allowedSeverities, `${label}.severity`),
    });
}
export function contractError(message, cause) {
    return actionError('ZOLT-CONTRACT-001', message, cause);
}

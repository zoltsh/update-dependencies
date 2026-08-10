import { MAX_ACTION_OUTPUT_BYTES, MAX_PUBLIC_OUTPUT_CHARACTERS } from './constants.js';
import { actionError, UpdateDependenciesError } from './errors.js';

const ANSI = /\u001B\[[0-?]*[ -/]*[@-~]/gu;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const SECRET_NAME = /(?:TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|CREDENTIAL)/iu;

export function registeredSecrets(environment: NodeJS.ProcessEnv, extras: readonly string[] = []): readonly string[] {
    const candidates = [...extras];
    for (const [name, value] of Object.entries(environment)) {
        if (value !== undefined && SECRET_NAME.test(name)) candidates.push(value);
    }
    return [...new Set(candidates.filter((value) => value.length >= 4))]
        .sort((left, right) => right.length - left.length);
}

export function publicText(value: string, secrets: readonly string[]): string {
    let result = value.replace(ANSI, '').replace(CONTROL, '');
    for (const secret of secretVariants(secrets)) result = result.replaceAll(secret, '[REDACTED]');
    if (result.length > MAX_PUBLIC_OUTPUT_CHARACTERS) {
        result = `${result.slice(0, MAX_PUBLIC_OUTPUT_CHARACTERS)}… [truncated]`;
    }
    return result;
}

export function publicJson(value: unknown, secrets: readonly string[]): string {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
        throw actionError('ZOLT-OUTPUT-002', 'plan could not be encoded as JSON.');
    }
    let rendered = encoded;
    for (const secret of jsonSecretVariants(secrets)) rendered = rendered.replaceAll(secret, '[REDACTED]');
    if (Buffer.byteLength(rendered, 'utf8') > MAX_ACTION_OUTPUT_BYTES) {
        throw actionError('ZOLT-OUTPUT-002', 'plan exceeds the Action output byte limit.');
    }
    return rendered;
}

export function publicErrorMessage(error: unknown, secrets: readonly string[]): string {
    if (error instanceof UpdateDependenciesError) {
        return `${error.code}: ${publicText(error.message, secrets)}`;
    }
    if (error instanceof Error) return `ZOLT-UNEXPECTED-001: ${publicText(error.message, secrets)}`;
    return `ZOLT-UNEXPECTED-001: ${publicText(String(error), secrets)}`;
}

function jsonSecretVariants(secrets: readonly string[]): readonly string[] {
    return secretVariants(secrets)
        .map((secret) => JSON.stringify(secret).slice(1, -1))
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);
}

function secretVariants(secrets: readonly string[]): readonly string[] {
    const variants = new Set<string>();
    for (const secret of secrets) {
        variants.add(secret);
        variants.add(encodeURIComponent(secret));
        variants.add(Buffer.from(secret, 'utf8').toString('base64'));
    }
    return [...variants].filter(Boolean).sort((left, right) => right.length - left.length);
}

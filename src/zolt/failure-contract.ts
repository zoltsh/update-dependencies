import { actionError } from '../errors.js';
import {
    boundedArray,
    enumString,
    exactObject,
    literal,
    nonEmptyString,
    nullableString,
    parseMachineDocument,
} from './contract-values.js';

const ERROR = new Set(['error'] as const);
const MAX_DIAGNOSTICS = 10_000;

export interface MachineFailureDiagnostic {
    readonly message: string;
    readonly nextStep: string | null;
    readonly severity: 'error';
}

export interface MachineFailure {
    readonly command: 'outdated' | 'update';
    readonly diagnostics: readonly MachineFailureDiagnostic[];
    readonly schemaVersion: 1 | 2;
    readonly status: 'failed';
}

export function decodeMachineFailure(
    document: string,
    command: MachineFailure['command'],
    schemaVersion: MachineFailure['schemaVersion'],
): MachineFailure {
    const root = exactObject(parseMachineDocument(document, `Zolt ${command} failure`), command, [
        'command',
        'diagnostics',
        'schemaVersion',
        'status',
    ]);
    literal(root.schemaVersion, schemaVersion, 'schemaVersion');
    literal(root.command, command, 'command');
    literal(root.status, 'failed', 'status');
    const rawDiagnostics = boundedArray(root.diagnostics, 'diagnostics', MAX_DIAGNOSTICS);
    if (rawDiagnostics.length === 0) {
        throw actionError('ZOLT-CONTRACT-001', 'A Zolt machine failure must include at least one diagnostic.');
    }
    const diagnostics = rawDiagnostics.map((value, index) => {
        const label = `diagnostics[${index.toString()}]`;
        const diagnostic = exactObject(value, label, ['message', 'nextStep', 'severity']);
        return Object.freeze({
            message: nonEmptyString(diagnostic.message, `${label}.message`),
            nextStep: nullableString(diagnostic.nextStep, `${label}.nextStep`),
            severity: enumString(diagnostic.severity, ERROR, `${label}.severity`),
        });
    });
    return Object.freeze({
        command,
        diagnostics: Object.freeze(diagnostics),
        schemaVersion,
        status: 'failed',
    });
}

export function machineFailureMessage(failure: MachineFailure): string {
    return failure.diagnostics
        .map((diagnostic) => diagnostic.nextStep === null
            ? diagnostic.message
            : `${diagnostic.message} Next: ${diagnostic.nextStep}`)
        .join(' ');
}

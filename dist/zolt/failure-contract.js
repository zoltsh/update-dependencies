import { actionError } from '../errors.js';
import { boundedArray, enumString, exactObject, literal, nonEmptyString, nullableString, parseMachineDocument, } from './contract-values.js';
const ERROR = new Set(['error']);
const MAX_DIAGNOSTICS = 10_000;
export function decodeMachineFailure(document, command, schemaVersion) {
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
export function machineFailureMessage(failure) {
    return failure.diagnostics
        .map((diagnostic) => diagnostic.nextStep === null
        ? diagnostic.message
        : `${diagnostic.message} Next: ${diagnostic.nextStep}`)
        .join(' ');
}

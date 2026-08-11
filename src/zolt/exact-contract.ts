import {
    canonicalRelativeFile,
    canonicalZoltManifestPath,
    canonicalZoltRootLockPath,
} from '../paths.js';
import type {
    ChangeClass,
    ExactUpdateResult,
    ExactUpdateTarget,
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
    parseMachineDocument,
    stringArray,
} from './contract-values.js';
import { decodeTargetId } from './contracts-v2.js';

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
const DIAGNOSTICS = new Set(['info', 'warning'] as const);
const MAX_CHANGED_FILES = 16;
const MAX_FAN_OUT = 100_000;

export function decodeExactUpdateResult(document: string): ExactUpdateResult {
    const root = exactObject(parseMachineDocument(document, 'Zolt exact update'), 'update', [
        'applied',
        'changed',
        'changedFiles',
        'class',
        'command',
        'diagnostics',
        'dryRun',
        'fanOut',
        'from',
        'resolved',
        'schemaVersion',
        'status',
        'target',
        'to',
    ]);
    literal(root.schemaVersion, 2, 'schemaVersion');
    literal(root.command, 'update', 'command');
    literal(root.status, 'ok', 'status');
    const result = Object.freeze({
        applied: booleanValue(root.applied, 'applied'),
        changed: booleanValue(root.changed, 'changed'),
        changedFiles: decodeChangedFiles(root.changedFiles),
        changeClass: nullableEnum(root.class, CHANGE_CLASSES, 'class'),
        command: 'update' as const,
        diagnostics: Object.freeze(boundedArray(root.diagnostics, 'diagnostics', 10_000)
            .map((value, index) => decodeDiagnostic(value, index, DIAGNOSTICS))),
        dryRun: booleanValue(root.dryRun, 'dryRun'),
        fanOut: stringArray(root.fanOut, 'fanOut', MAX_FAN_OUT),
        from: nonEmptyString(root.from, 'from'),
        resolved: booleanValue(root.resolved, 'resolved'),
        schemaVersion: 2 as const,
        status: 'ok' as const,
        target: decodeTarget(root.target),
        to: nonEmptyString(root.to, 'to'),
    });
    validateEffects(result);
    return result;
}

function decodeTarget(value: unknown): ExactUpdateTarget {
    const target = exactObject(value, 'target', [
        'identifier',
        'lockfilePath',
        'manifestPath',
        'section',
        'surface',
        'targetId',
        'updateable',
    ]);
    literal(target.updateable, true, 'target.updateable');
    return Object.freeze({
        identifier: nonEmptyString(target.identifier, 'target.identifier'),
        lockfilePath: canonicalZoltRootLockPath(
            nonEmptyString(target.lockfilePath, 'target.lockfilePath'),
            'target.lockfilePath',
        ),
        manifestPath: canonicalZoltManifestPath(
            nonEmptyString(target.manifestPath, 'target.manifestPath'),
            'target.manifestPath',
        ),
        section: nonEmptyString(target.section, 'target.section'),
        surface: enumString(target.surface, SURFACES, 'target.surface'),
        targetId: decodeTargetId(target.targetId, 'target.targetId'),
        updateable: true,
    });
}

function decodeChangedFiles(value: unknown): readonly string[] {
    const paths = boundedArray(value, 'changedFiles', MAX_CHANGED_FILES)
        .map((entry, index) => contractPath(entry, `changedFiles[${index.toString()}]`));
    if (new Set(paths).size !== paths.length) {
        throw contractError('changedFiles must contain unique canonical paths.');
    }
    return Object.freeze(paths);
}

function contractPath(value: unknown, label: string): string {
    return canonicalRelativeFile(nonEmptyString(value, label), label);
}

function validateEffects(result: ExactUpdateResult): void {
    const allowedChangedFiles = [result.target.manifestPath, result.target.lockfilePath];
    if (
        result.changedFiles.some((path, index) => path !== allowedChangedFiles[index])
        || result.changedFiles.length > allowedChangedFiles.length
    ) {
        throw contractError('changedFiles must contain only the target manifest followed by the root lockfile.');
    }
    if (!result.changed) {
        if (
            result.from !== result.to
            || result.changeClass !== null
            || result.applied
            || result.resolved
            || result.changedFiles.length !== 0
        ) {
            throw contractError('An unchanged exact update must be a same-version no-op without file effects.');
        }
        return;
    }
    if (result.from === result.to || result.changeClass === null) {
        throw contractError('A changed exact update must report distinct versions and a change class.');
    }
    if (result.dryRun) {
        if (result.applied || result.resolved || result.changedFiles.length !== 0) {
            throw contractError('A dry-run exact update must not report applied, resolved, or changed files.');
        }
        return;
    }
    if (!result.applied || result.changedFiles[0] !== result.target.manifestPath) {
        throw contractError('An applied exact update must report its manifest as the first changed file.');
    }
    if (!result.resolved && result.changedFiles.length !== 1) {
        throw contractError('A no-resolve exact update must report only its changed manifest.');
    }
    if (result.resolved && !result.applied) {
        throw contractError('A resolved exact update must also be applied.');
    }
}

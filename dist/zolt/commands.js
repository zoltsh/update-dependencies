import { UpdateDependenciesError } from '../errors.js';
import { ZOLT_OUTDATED_SCHEMA_VERSION } from '../generated/zolt-release.js';
import { decodeOutdatedReport } from './contracts.js';
import { decodeOutdatedReportV2 } from './contracts-v2.js';
import { decodeExactUpdateResult } from './exact-contract.js';
import { runZolt } from './process.js';
export async function captureOutdated(binary, inputs, selection, environment, dependencies = {}) {
    const schemaVersion = dependencies.schemaVersion ?? ZOLT_OUTDATED_SCHEMA_VERSION;
    const arguments_ = ['--color', 'never', '--progress', 'never', 'outdated', '--format', 'json'];
    if (schemaVersion === 2)
        arguments_.push('--schema-version', '2');
    if (inputs.includePrereleases)
        arguments_.push('--include-prereleases');
    arguments_.push(...inputs.selectors);
    const result = await (dependencies.run ?? runZolt)(binary, arguments_, selection.root, environment, 120_000);
    requireQuietStderr(result.stderr, 'outdated machine document');
    return schemaVersion === 1
        ? (dependencies.decodeV1 ?? decodeOutdatedReport)(result.stdout)
        : (dependencies.decodeV2 ?? decodeOutdatedReportV2)(result.stdout);
}
export async function runExactUpdate(binary, cwd, environment, request, dependencies = {}) {
    const arguments_ = [
        '--color',
        'never',
        '--progress',
        'never',
        'update',
        '--target-id',
        request.targetId,
        '--to',
        request.toVersion,
        '--format',
        'json',
        '--schema-version',
        '2',
    ];
    if (request.includePrereleases)
        arguments_.push('--include-prereleases');
    const result = await (dependencies.run ?? runZolt)(binary, arguments_, cwd, environment, 120_000);
    requireQuietStderr(result.stderr, 'exact-update machine document');
    return (dependencies.decode ?? decodeExactUpdateResult)(result.stdout);
}
export async function verifyLockedOffline(binary, selection, cwd, environment, dependencies = {}) {
    const arguments_ = ['--color', 'never', '--progress', 'never', 'resolve'];
    if (selection.mode === 'workspace')
        arguments_.push('--workspace');
    arguments_.push('--locked', '--offline');
    const result = await (dependencies.run ?? runZolt)(binary, arguments_, cwd, environment, 120_000);
    requireQuietStderr(result.stderr, 'locked offline verification');
}
function requireQuietStderr(stderr, label) {
    if (stderr !== '') {
        throw new UpdateDependenciesError('ZOLT-PROCESS-002', `Zolt wrote unexpected diagnostic output while producing its ${label}.`);
    }
}

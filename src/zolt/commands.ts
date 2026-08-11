import { actionError, UpdateDependenciesError } from '../errors.js';
import { ZOLT_OUTDATED_SCHEMA_VERSION } from '../generated/zolt-release.js';
import type { ActionInputs } from '../inputs.js';
import type {
    Environment,
    ExactUpdateResult,
    OutdatedReport,
    ZoltProjectSelection,
} from '../types.js';
import { decodeOutdatedReport } from './contracts.js';
import { decodeOutdatedReportV2 } from './contracts-v2.js';
import { decodeExactUpdateResult } from './exact-contract.js';
import { decodeMachineFailure, machineFailureMessage } from './failure-contract.js';
import { runZolt, ZoltCommandFailure, type ProcessResult } from './process.js';

export interface CaptureDependencies {
    readonly decodeV1?: typeof decodeOutdatedReport;
    readonly decodeV2?: typeof decodeOutdatedReportV2;
    readonly run?: typeof runZolt;
    readonly schemaVersion?: 1 | 2;
}

export interface ExactCommandDependencies {
    readonly decode?: typeof decodeExactUpdateResult;
    readonly run?: typeof runZolt;
}

export async function captureOutdated(
    binary: string,
    inputs: ActionInputs,
    selection: ZoltProjectSelection,
    environment: Environment,
    dependencies: CaptureDependencies = {},
): Promise<OutdatedReport> {
    const schemaVersion = dependencies.schemaVersion ?? ZOLT_OUTDATED_SCHEMA_VERSION;
    const arguments_ = ['--color', 'never', '--progress', 'never', 'outdated', '--format', 'json'];
    if (schemaVersion === 2) arguments_.push('--schema-version', '2');
    if (inputs.includePrereleases) arguments_.push('--include-prereleases');
    arguments_.push(...inputs.selectors);
    arguments_.push('--cwd', selection.root);
    const result = await runMachineCommand(
        () => (dependencies.run ?? runZolt)(binary, arguments_, selection.root, environment, 120_000),
        'outdated',
        schemaVersion,
    );
    requireQuietStderr(result.stderr, 'outdated machine document');
    return schemaVersion === 1
        ? (dependencies.decodeV1 ?? decodeOutdatedReport)(result.stdout)
        : (dependencies.decodeV2 ?? decodeOutdatedReportV2)(result.stdout);
}

export async function runExactUpdate(
    binary: string,
    cwd: string,
    environment: Environment,
    request: {
        readonly includePrereleases: boolean;
        readonly targetId: string;
        readonly toVersion: string;
    },
    dependencies: ExactCommandDependencies = {},
): Promise<ExactUpdateResult> {
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
    if (request.includePrereleases) arguments_.push('--include-prereleases');
    arguments_.push('--cwd', cwd);
    const result = await runMachineCommand(
        () => (dependencies.run ?? runZolt)(binary, arguments_, cwd, environment, 120_000),
        'update',
        2,
    );
    requireQuietStderr(result.stderr, 'exact-update machine document');
    return (dependencies.decode ?? decodeExactUpdateResult)(result.stdout);
}

export async function verifyLockedOffline(
    binary: string,
    selection: Pick<ZoltProjectSelection, 'mode'>,
    cwd: string,
    environment: Environment,
    dependencies: Pick<ExactCommandDependencies, 'run'> = {},
): Promise<void> {
    const arguments_ = ['--color', 'never', '--progress', 'never', 'resolve'];
    if (selection.mode === 'workspace') arguments_.push('--workspace');
    arguments_.push('--locked', '--offline', '--cwd', cwd);
    const result = await (dependencies.run ?? runZolt)(binary, arguments_, cwd, environment, 120_000);
    requireQuietStderr(result.stderr, 'locked offline verification');
}

function requireQuietStderr(stderr: string, label: string): void {
    if (stderr !== '') {
        throw new UpdateDependenciesError(
            'ZOLT-PROCESS-002',
            `Zolt wrote unexpected diagnostic output while producing its ${label}.`,
        );
    }
}

async function runMachineCommand(
    operation: () => Promise<ProcessResult>,
    command: 'outdated' | 'update',
    schemaVersion: 1 | 2,
): Promise<ProcessResult> {
    try {
        return await operation();
    } catch (error) {
        if (!(error instanceof ZoltCommandFailure)) throw error;
        requireQuietStderr(error.stderr, `${command} failure machine document`);
        const failure = decodeMachineFailure(error.stdout, command, schemaVersion);
        throw actionError(
            'ZOLT-COMMAND-007',
            `Zolt ${command} failed: ${machineFailureMessage(failure)}`,
            error,
        );
    }
}

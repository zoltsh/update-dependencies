import type { ActionCore } from './action/core.js';
import { actionError } from './errors.js';
import type { UpdateCeiling, WorkspaceMode } from './types.js';

export interface ActionInputs {
    readonly directory: string;
    readonly dryRun: boolean;
    readonly githubToken: string;
    readonly includePrereleases: boolean;
    readonly openPullRequestsLimit: number;
    readonly registryEnv: readonly string[];
    readonly selectors: readonly string[];
    readonly updateCeiling: UpdateCeiling;
    readonly workspace: WorkspaceMode;
}

export function readInputs(core: ActionCore, registerSecret: (secret: string) => void): ActionInputs {
    const githubToken = core.getInput('github-token');
    if (githubToken === '') throw actionError('ZOLT-INPUT-010', 'github-token must not be empty.');
    registerSecret(githubToken);
    return {
        directory: directoryInput(core.getInput('directory') || '.'),
        dryRun: booleanInput(core.getInput('dry-run') || 'true', 'dry-run'),
        githubToken,
        includePrereleases: booleanInput(
            core.getInput('include-prereleases') || 'false',
            'include-prereleases',
        ),
        openPullRequestsLimit: integerInput(
            core.getInput('open-pull-requests-limit') || '5',
            'open-pull-requests-limit',
            0,
            100,
        ),
        registryEnv: environmentNames(core.getInput('registry-env')),
        selectors: lines(core.getInput('selectors'), 'selectors', 100),
        updateCeiling: choice(
            core.getInput('update-ceiling') || 'minor',
            'update-ceiling',
            ['patch', 'minor', 'major'] as const,
        ),
        workspace: choice(
            core.getInput('workspace') || 'auto',
            'workspace',
            ['auto', 'true', 'false'] as const,
        ),
    };
}

function booleanInput(value: string, name: string): boolean {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw actionError('ZOLT-INPUT-001', `${name} must be true or false.`);
}

function integerInput(value: string, name: string, minimum: number, maximum: number): number {
    if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
        throw actionError('ZOLT-INPUT-002', `${name} must be an integer from ${minimum.toString()} to ${maximum.toString()}.`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw actionError('ZOLT-INPUT-002', `${name} must be an integer from ${minimum.toString()} to ${maximum.toString()}.`);
    }
    return parsed;
}

function choice<const Values extends readonly string[]>(
    value: string,
    name: string,
    values: Values,
): Values[number] {
    if ((values as readonly string[]).includes(value)) return value as Values[number];
    throw actionError('ZOLT-INPUT-003', `${name} must be one of: ${values.join(', ')}.`);
}

function lines(value: string, name: string, maximum: number): readonly string[] {
    const result = [...new Set(value.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean))];
    if (result.length > maximum) throw actionError('ZOLT-INPUT-004', `${name} accepts at most ${maximum.toString()} entries.`);
    for (const entry of result) {
        if (entry.length > 256 || /[\u0000-\u001F\u007F]/u.test(entry)) {
            throw actionError('ZOLT-INPUT-005', `${name} contains an invalid entry.`);
        }
    }
    return result;
}

function environmentNames(value: string): readonly string[] {
    const names = lines(value, 'registry-env', 32);
    for (const name of names) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
            throw actionError('ZOLT-INPUT-006', `registry-env contains invalid environment variable name ${name}.`);
        }
        const upper = name.toUpperCase();
        if (
            upper === 'GITHUB_TOKEN'
            || upper === 'GH_TOKEN'
            || upper === 'INPUT_GITHUB-TOKEN'
            || upper === 'INPUT_GITHUB_TOKEN'
            || upper.startsWith('ACTIONS_')
            || /^(?:GH|GITHUB)_.*(?:PAT|TOKEN)$/u.test(upper)
        ) {
            throw actionError('ZOLT-INPUT-007', `registry-env cannot expose GitHub credential channel ${name} to Zolt.`);
        }
    }
    return names;
}

function directoryInput(value: string): string {
    const checked = nonEmpty(value, 'directory');
    if (checked.includes('\\') || checked.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(checked)) {
        throw actionError('ZOLT-INPUT-010', 'directory must be a repository-relative POSIX path.');
    }
    const segments = checked.split('/').filter((segment) => segment !== '' && segment !== '.');
    if (segments.some((segment) => segment === '..')) {
        throw actionError('ZOLT-INPUT-010', 'directory cannot contain parent traversal.');
    }
    return segments.length === 0 ? '.' : segments.join('/');
}

function nonEmpty(value: string, name: string): string {
    if (value.trim() === '') throw actionError('ZOLT-INPUT-008', `${name} must not be empty.`);
    if (/[\u0000-\u001F\u007F]/u.test(value)) throw actionError('ZOLT-INPUT-009', `${name} contains control characters.`);
    return value;
}

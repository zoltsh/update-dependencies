import type { ActionInputs } from '../../src/inputs.js';
import type {
    OutdatedEntry,
    OutdatedReport,
    OutdatedScope,
    ZoltProjectSelection,
} from '../../src/types.js';

export function actionInputs(overrides: Partial<ActionInputs> = {}): ActionInputs {
    return {
        directory: '.',
        dryRun: true,
        githubToken: 'github-token-value',
        includePrereleases: false,
        openPullRequestsLimit: 5,
        registryEnv: [],
        selectors: [],
        updateCeiling: 'minor',
        workspace: 'auto',
        ...overrides,
    };
}

export function outdatedEntry(overrides: Partial<OutdatedEntry> = {}): OutdatedEntry {
    return {
        candidates: { major: '2.0.0', minor: '1.1.0', patch: '1.0.1' },
        current: '1.0.0',
        governs: [],
        identifier: 'com.example:demo',
        members: [],
        notes: [],
        section: '[dependencies]',
        selectedInMajor: '1.1.0',
        selectedInMajorClass: 'minor',
        selectedLatest: '2.0.0',
        selectedLatestClass: 'major',
        source: 'central',
        status: 'updateAvailable',
        surface: 'dependency',
        ...overrides,
    };
}

export function outdatedScope(
    label = 'demo',
    entries: readonly OutdatedEntry[] = [outdatedEntry()],
): OutdatedScope {
    return { entries, label };
}

export function outdatedReport(scopes: readonly OutdatedScope[] = [outdatedScope()]): OutdatedReport {
    return {
        command: 'outdated',
        diagnostics: [],
        notes: [],
        schemaVersion: 1,
        scopes,
        status: 'ok',
    };
}

export function projectSelection(overrides: Partial<ZoltProjectSelection> = {}): ZoltProjectSelection {
    return {
        lockfilePath: 'zolt.lock',
        manifestPath: 'zolt.toml',
        mode: 'project',
        relativeRoot: '.',
        root: '/private/repository',
        ...overrides,
    };
}

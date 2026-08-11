import type { ActionInputs } from '../../src/inputs.js';
import type {
    OutdatedEntryV1,
    OutdatedEntryV2,
    OutdatedReportV1,
    OutdatedReportV2,
    OutdatedScopeV1,
    OutdatedScopeV2,
    RepositoryView,
    ZoltProjectSelection,
} from '../../src/types.js';

export const TEST_TARGET_ID = 'zt1_vcc-lFhiR4a_S4Vab01gw0_gcPDgShIiT8IdjXa5MhM';

export function testTargetId(fill: number): string {
    return `zt1_${Buffer.alloc(32, fill).toString('base64url')}`;
}

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

export function outdatedEntry(overrides: Partial<OutdatedEntryV1> = {}): OutdatedEntryV1 {
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

export function outdatedEntryV2(overrides: Partial<OutdatedEntryV2> = {}): OutdatedEntryV2 {
    return {
        ...outdatedEntry(),
        targetId: TEST_TARGET_ID,
        updateable: true,
        updateBlocker: null,
        ...overrides,
    };
}

export function outdatedScope(
    label = 'demo',
    entries: readonly OutdatedEntryV1[] = [outdatedEntry()],
): OutdatedScopeV1 {
    return { entries, label };
}

export function outdatedScopeV2(
    label = 'demo',
    entries: readonly OutdatedEntryV2[] = [outdatedEntryV2()],
    paths: { readonly lockfilePath?: string; readonly manifestPath?: string } = {},
): OutdatedScopeV2 {
    return {
        entries,
        label,
        lockfilePath: paths.lockfilePath ?? 'zolt.lock',
        manifestPath: paths.manifestPath ?? 'zolt.toml',
    };
}

export function outdatedReport(scopes: readonly OutdatedScopeV1[] = [outdatedScope()]): OutdatedReportV1 {
    return {
        command: 'outdated',
        diagnostics: [],
        notes: [],
        schemaVersion: 1,
        scopes,
        status: 'ok',
    };
}

export function outdatedReportV2(
    scopes: readonly OutdatedScopeV2[] = [outdatedScopeV2()],
): OutdatedReportV2 {
    return {
        command: 'outdated',
        diagnostics: [],
        notes: [],
        schemaVersion: 2,
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

export function repositoryView(overrides: Partial<RepositoryView> = {}): RepositoryView {
    return {
        cleanup: async () => undefined,
        createMutableCopy: async () => { throw new Error('Mutable copy was not expected in this test.'); },
        directory: '/private/repository',
        directoryInput: '.',
        verify: async () => undefined,
        workspace: '/private/repository',
        ...overrides,
    };
}

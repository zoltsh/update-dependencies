import type { ActionInputs } from '../../src/inputs.js';
import { createZoltTargetId } from '../../src/zolt/target-id.js';
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

export const TEST_TARGET_ID = targetIdFor();

export function targetIdFor(overrides: {
    readonly identifier?: string;
    readonly manifestPath?: string;
    readonly section?: string;
    readonly surface?: OutdatedEntryV2['surface'];
} = {}): string {
    return createZoltTargetId({
        identifier: overrides.identifier ?? 'com.example:demo',
        manifestPath: overrides.manifestPath ?? 'zolt.toml',
        section: overrides.section ?? '[dependencies]',
        surface: overrides.surface ?? 'dependency',
    });
}

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

export function outdatedEntryV2(
    overrides: Partial<OutdatedEntryV2> = {},
    manifestPath = 'zolt.toml',
): OutdatedEntryV2 {
    const entry = {
        ...outdatedEntry(),
        updateable: true,
        updateBlocker: null,
        ...overrides,
    };
    return {
        ...entry,
        targetId: overrides.targetId ?? targetIdFor({
            identifier: entry.identifier,
            manifestPath,
            section: entry.section,
            surface: entry.surface,
        }),
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
    entries?: readonly OutdatedEntryV2[],
    paths: { readonly lockfilePath?: string; readonly manifestPath?: string } = {},
): OutdatedScopeV2 {
    const manifestPath = paths.manifestPath ?? 'zolt.toml';
    return {
        entries: entries ?? [outdatedEntryV2({}, manifestPath)],
        label,
        lockfilePath: paths.lockfilePath ?? 'zolt.lock',
        manifestPath,
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

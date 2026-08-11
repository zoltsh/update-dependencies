export type Environment = NodeJS.ProcessEnv;
export type WorkspaceMode = 'auto' | 'false' | 'true';
export type UpdateCeiling = 'major' | 'minor' | 'patch';
export type ReleaseTarget = 'linux-arm64' | 'linux-x64' | 'macos-arm64' | 'macos-x64';
export type ChangeClass = 'major' | 'minor' | 'patch';
export type OutdatedStatus = 'current' | 'unknown' | 'updateAvailable';
export type OutdatedSurface =
    | 'annotationProcessor'
    | 'dependency'
    | 'dependencyConstraint'
    | 'execToolCoordinate'
    | 'openapiTool'
    | 'platform'
    | 'protobufTool'
    | 'versionAlias';

export interface ReleaseArtifact {
    readonly archive: string;
    readonly archiveUrl: string;
    readonly sha256: string;
}

export interface Diagnostic {
    readonly message: string;
    readonly severity: 'error' | 'info' | 'warning';
}

export interface OutdatedCandidates {
    readonly major: string | null;
    readonly minor: string | null;
    readonly patch: string | null;
}

export interface OutdatedEntryBase {
    readonly candidates: OutdatedCandidates;
    readonly current: string;
    readonly governs: readonly string[];
    readonly identifier: string;
    readonly members: readonly string[];
    readonly notes: readonly string[];
    readonly section: string;
    readonly selectedInMajor: string | null;
    readonly selectedInMajorClass: ChangeClass | null;
    readonly selectedLatest: string | null;
    readonly selectedLatestClass: ChangeClass | null;
    readonly source: string | null;
    readonly status: OutdatedStatus;
    readonly surface: OutdatedSurface;
}

export type OutdatedEntryV1 = OutdatedEntryBase;

export interface OutdatedEntryV2 extends OutdatedEntryBase {
    readonly targetId: string;
    readonly updateable: boolean;
    readonly updateBlocker: string | null;
}

export interface OutdatedScopeV1 {
    readonly entries: readonly OutdatedEntryV1[];
    readonly label: string;
}

export interface OutdatedScopeV2 {
    readonly entries: readonly OutdatedEntryV2[];
    readonly label: string;
    readonly lockfilePath: string;
    readonly manifestPath: string;
}

export interface OutdatedReportV1 {
    readonly command: 'outdated';
    readonly diagnostics: readonly Diagnostic[];
    readonly notes: readonly string[];
    readonly schemaVersion: 1;
    readonly scopes: readonly OutdatedScopeV1[];
    readonly status: 'ok';
}

export interface OutdatedReportV2 {
    readonly command: 'outdated';
    readonly diagnostics: readonly Diagnostic[];
    readonly notes: readonly string[];
    readonly schemaVersion: 2;
    readonly scopes: readonly OutdatedScopeV2[];
    readonly status: 'ok';
}

export type OutdatedEntry = OutdatedEntryV1 | OutdatedEntryV2;
export type OutdatedScope = OutdatedScopeV1 | OutdatedScopeV2;
export type OutdatedReport = OutdatedReportV1 | OutdatedReportV2;

export interface RepositoryChangeSet {
    readonly added: readonly string[];
    readonly deleted: readonly string[];
    readonly missingDirectories: readonly string[];
    readonly modeChanged: readonly string[];
    readonly modified: readonly string[];
    readonly paths: readonly string[];
    readonly unexpectedDirectories: readonly string[];
}

export interface MutableRepositoryCopy {
    readonly directory: string;
    readonly directoryInput: string;
    readonly workspace: string;
    cleanup(): Promise<void>;
    inspectChanges(): Promise<RepositoryChangeSet>;
}

export interface RepositoryView {
    readonly directory: string;
    readonly directoryInput: string;
    readonly workspace: string;
    cleanup(): Promise<void>;
    createMutableCopy(): Promise<MutableRepositoryCopy>;
    verify(): Promise<void>;
}

export interface ZoltProjectSelection {
    readonly lockfilePath: string;
    readonly manifestPath: string;
    readonly mode: 'project' | 'workspace';
    readonly relativeRoot: string;
    readonly root: string;
}

export interface PlannedUpdate {
    readonly authoritativeTarget: boolean;
    readonly branchHash: string;
    readonly changeClass: ChangeClass;
    readonly currentVersion: string;
    readonly fanOut: readonly string[];
    readonly identifier: string;
    readonly lockfilePath: string;
    readonly managedId: string;
    readonly manifestPath: string;
    readonly members: readonly string[];
    readonly notes: readonly string[];
    readonly scope: string;
    readonly section: string;
    readonly sourceRepository: string | null;
    readonly surface: OutdatedSurface;
    readonly targetId: string;
    readonly targetVersion: string;
    readonly zoltLockfilePath: string;
    readonly zoltManifestPath: string;
    readonly zoltRoot: string;
}

export interface BlockedUpdate {
    readonly currentVersion: string;
    readonly identifier: string;
    readonly manifestPath: string;
    readonly notes: readonly string[];
    readonly reason: string;
    readonly scope: string;
    readonly section: string;
    readonly surface: OutdatedSurface;
    readonly targetId?: string;
}

export interface ExcludedUpdate extends BlockedUpdate {}

export interface UpdatePlan {
    readonly blocked: readonly BlockedUpdate[];
    readonly deferred: readonly PlannedUpdate[];
    readonly diagnostics: readonly string[];
    readonly eligible: readonly PlannedUpdate[];
    readonly outsidePolicy: readonly ExcludedUpdate[];
    readonly selected: readonly PlannedUpdate[];
}

export interface PullRequestPreview {
    readonly body: string;
    readonly branch: string;
    readonly marker: string;
    readonly title: string;
}

export interface CompactPlanItem {
    readonly authoritativeTarget: boolean;
    readonly branch: string;
    readonly changeClass: ChangeClass;
    readonly fanOut: readonly string[];
    readonly from: string;
    readonly identifier: string;
    readonly lockfilePath: string;
    readonly managedId: string;
    readonly manifestPath: string;
    readonly members: readonly string[];
    readonly section: string;
    readonly surface: OutdatedSurface;
    readonly targetId: string;
    readonly title: string;
    readonly to: string;
    readonly zoltRoot: string;
}

export interface ExactUpdateTarget {
    readonly identifier: string;
    readonly lockfilePath: string;
    readonly manifestPath: string;
    readonly section: string;
    readonly surface: OutdatedSurface;
    readonly targetId: string;
    readonly updateable: true;
}

export interface ExactUpdateResult {
    readonly applied: boolean;
    readonly changed: boolean;
    readonly changedFiles: readonly string[];
    readonly changeClass: ChangeClass | null;
    readonly command: 'update';
    readonly diagnostics: readonly Diagnostic[];
    readonly dryRun: boolean;
    readonly fanOut: readonly string[];
    readonly from: string;
    readonly resolved: boolean;
    readonly schemaVersion: 2;
    readonly status: 'ok';
    readonly target: ExactUpdateTarget;
    readonly to: string;
}

export interface UpdateArtifactFile {
    readonly content: Buffer;
    readonly mode: '100644' | '100755';
    readonly path: string;
}

export interface ExactUpdateArtifact {
    readonly changedFiles: readonly string[];
    readonly files: readonly UpdateArtifactFile[];
    readonly result: ExactUpdateResult;
    readonly target: PlannedUpdate;
}

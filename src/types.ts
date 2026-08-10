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

export interface OutdatedEntry {
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

export interface OutdatedScope {
    readonly entries: readonly OutdatedEntry[];
    readonly label: string;
}

export interface OutdatedReport {
    readonly command: 'outdated';
    readonly diagnostics: readonly Diagnostic[];
    readonly notes: readonly string[];
    readonly schemaVersion: 1;
    readonly scopes: readonly OutdatedScope[];
    readonly status: 'ok';
}

export interface RepositoryView {
    readonly directory: string;
    readonly directoryInput: string;
    readonly workspace: string;
    cleanup(): Promise<void>;
}

export interface ZoltProjectSelection {
    readonly lockfilePath: string;
    readonly manifestPath: string;
    readonly mode: 'project' | 'workspace';
    readonly relativeRoot: string;
    readonly root: string;
}

export interface PlannedUpdate {
    readonly branchHash: string;
    readonly changeClass: ChangeClass;
    readonly currentVersion: string;
    readonly fanOut: readonly string[];
    readonly identifier: string;
    readonly lockfilePath: string;
    readonly manifestPath: string;
    readonly members: readonly string[];
    readonly notes: readonly string[];
    readonly provisionalTargetId: string;
    readonly scope: string;
    readonly section: string;
    readonly sourceRepository: string | null;
    readonly surface: OutdatedSurface;
    readonly targetVersion: string;
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
    readonly branch: string;
    readonly changeClass: ChangeClass;
    readonly fanOut: readonly string[];
    readonly from: string;
    readonly identifier: string;
    readonly lockfilePath: string;
    readonly manifestPath: string;
    readonly members: readonly string[];
    readonly section: string;
    readonly surface: OutdatedSurface;
    readonly provisionalTargetId: string;
    readonly title: string;
    readonly to: string;
}

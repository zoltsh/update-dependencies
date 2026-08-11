import { actionError, UpdateDependenciesError } from '../errors.js';
import { prepareExactUpdateArtifact, } from '../update/executor.js';
import { renderManagedPullRequest, renderPullRequestPreview } from './preview.js';
import { reconcileManagedPullRequests, } from './reconcile.js';
export class ManagedPublicationFailure extends UpdateDependenciesError {
    visibleWrites;
    constructor(cause, visibleWrites) {
        const snapshot = Object.freeze([...visibleWrites]);
        super('ZOLT-PUBLISH-002', `Managed publication failed after ${describeWrites(snapshot)}: ${failureReason(cause)}`, { cause });
        this.name = 'ManagedPublicationFailure';
        this.visibleWrites = snapshot;
    }
}
export async function publishManagedPullRequests(input, dependencies) {
    const api = dependencies.repositoryApi;
    const wait = dependencies.wait ?? waitFor;
    const desired = input.targets.map((target) => ({
        preview: renderPullRequestPreview(target, input.branchGeneration),
        target,
    }));
    const existing = await api.listOpenPullRequests();
    const reconciliation = reconcileManagedPullRequests({
        baseSha: input.baseSha,
        branchGeneration: input.branchGeneration,
        defaultBranch: input.defaultBranch,
        desired,
        existing,
        openPullRequestsLimit: input.openPullRequestsLimit,
        repositoryId: input.repositoryId,
        ...(input.retained === undefined ? {} : { retained: input.retained }),
    });
    if (!hasWrites(reconciliation)) {
        return Object.freeze({ reconciliation, visibleWrites: Object.freeze([]) });
    }
    const prepare = dependencies.prepareArtifact ?? prepareExactUpdateArtifact;
    await preflight(input, reconciliation, api);
    const artifacts = await prepareArtifacts(input, reconciliation, prepare);
    const visibleWrites = [];
    try {
        for (const pullRequest of reconciliation.close) {
            await requireWriteBoundary(input, api, pullRequest.branch, pullRequest.headSha);
            await api.closePullRequest(pullRequest.number);
            visibleWrites.push(Object.freeze({
                branch: pullRequest.branch,
                kind: 'pull-request-closed',
                number: pullRequest.number,
            }));
        }
        for (const matched of reconciliation.refresh) {
            await refreshPullRequest(input, matched, requireArtifact(artifacts, matched.desired.target), api, visibleWrites);
        }
        for (const entry of reconciliation.create) {
            await createPullRequest(input, entry.target, requireArtifact(artifacts, entry.target), api, visibleWrites, wait);
        }
    }
    catch (error) {
        if (visibleWrites.length === 0)
            throw error;
        throw new ManagedPublicationFailure(error, visibleWrites);
    }
    return Object.freeze({
        reconciliation,
        visibleWrites: Object.freeze([...visibleWrites]),
    });
}
async function preflight(input, reconciliation, api) {
    await requireDefaultBranch(input, api);
    for (const pullRequest of reconciliation.close) {
        await requireManagedHead(api, pullRequest.branch, pullRequest.headSha);
    }
    for (const matched of reconciliation.refresh) {
        await requireManagedHead(api, matched.existing.branch, matched.existing.headSha);
    }
    for (const entry of reconciliation.create) {
        await requireManagedHead(api, entry.preview.branch, null);
    }
}
async function prepareArtifacts(input, reconciliation, prepare) {
    const artifacts = new Map();
    const targets = [
        ...reconciliation.refresh.map(({ desired }) => desired.target),
        ...reconciliation.create.map(({ target }) => target),
    ];
    for (const target of targets) {
        const artifact = await prepare({
            binary: input.binary,
            environment: input.environment,
            includePrereleases: input.includePrereleases,
            repository: input.repository,
            selection: input.selection,
            target,
        });
        if (artifact.target.managedId !== target.managedId) {
            throw publicationError('The prepared artifact does not match its managed target.');
        }
        artifacts.set(target.managedId, artifact);
    }
    return artifacts;
}
async function refreshPullRequest(input, matched, artifact, api, visibleWrites) {
    const { existing, desired } = matched;
    await requireWriteBoundary(input, api, existing.branch, existing.headSha);
    const commit = await api.createManagedCommit({
        baseSha: input.baseSha,
        files: artifact.files,
        message: desired.preview.title,
        previousManagedHead: existing.headSha,
    });
    await requireWriteBoundary(input, api, existing.branch, existing.headSha);
    await api.fastForwardGeneratedBranch(existing.branch, commit);
    visibleWrites.push(Object.freeze({ branch: existing.branch, kind: 'branch-updated', sha: commit }));
    await requireWriteBoundary(input, api, existing.branch, commit);
    const rendered = renderManagedPullRequest(desired.target, input.baseSha, commit, matched.marker.branchGeneration);
    await api.updatePullRequest(existing.number, {
        baseBranch: input.defaultBranch,
        body: rendered.body,
        branch: rendered.branch,
        title: rendered.title,
    });
    visibleWrites.push(Object.freeze({
        branch: existing.branch,
        kind: 'pull-request-updated',
        number: existing.number,
    }));
}
async function createPullRequest(input, target, artifact, api, visibleWrites, wait) {
    const preview = renderPullRequestPreview(target, input.branchGeneration);
    await requireWriteBoundary(input, api, preview.branch, null);
    const commit = await api.createManagedCommit({
        baseSha: input.baseSha,
        files: artifact.files,
        message: preview.title,
    });
    await requireWriteBoundary(input, api, preview.branch, null);
    await api.createGeneratedBranch(preview.branch, commit);
    visibleWrites.push(Object.freeze({ branch: preview.branch, kind: 'branch-created', sha: commit }));
    await requireCreatedWriteBoundary(input, api, preview.branch, commit, wait);
    const rendered = renderManagedPullRequest(target, input.baseSha, commit, input.branchGeneration);
    const number = await api.createPullRequest({
        baseBranch: input.defaultBranch,
        body: rendered.body,
        branch: rendered.branch,
        title: rendered.title,
    });
    visibleWrites.push(Object.freeze({
        branch: preview.branch,
        kind: 'pull-request-created',
        number,
    }));
}
async function requireCreatedWriteBoundary(input, api, branch, expectedHead, wait) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        await requireDefaultBranch(input, api);
        const current = await api.getGeneratedBranchHead(branch);
        if (current === expectedHead)
            return;
        if (current !== null) {
            throw publicationError(`Managed branch ${branch} changed after creation.`);
        }
        if (attempt < 4)
            await wait(200 * (attempt + 1));
    }
    throw publicationError(`Managed branch ${branch} was not readable after creation.`);
}
async function requireWriteBoundary(input, api, branch, expectedHead) {
    await requireDefaultBranch(input, api);
    await requireManagedHead(api, branch, expectedHead);
}
async function requireDefaultBranch(input, api) {
    const current = await api.getDefaultBranchHead(input.defaultBranch);
    if (current !== input.baseSha) {
        throw publicationError('The default branch advanced after planning; publication was aborted.');
    }
}
async function requireManagedHead(api, branch, expected) {
    const current = await api.getGeneratedBranchHead(branch);
    if (current !== expected) {
        throw publicationError(expected === null
            ? `Managed branch ${branch} already exists without an owned pull request.`
            : `Managed branch ${branch} changed after reconciliation.`);
    }
}
function requireArtifact(artifacts, target) {
    const artifact = artifacts.get(target.managedId);
    if (artifact === undefined)
        throw publicationError('A prepared update artifact is missing.');
    return artifact;
}
function hasWrites(reconciliation) {
    return reconciliation.close.length !== 0
        || reconciliation.create.length !== 0
        || reconciliation.refresh.length !== 0;
}
function describeWrites(writes) {
    if (writes.length === 0)
        return 'no visible writes';
    return `visible writes ${writes.map((write) => {
        if ('sha' in write) {
            return `${write.kind}:${write.branch}@${write.sha}`;
        }
        return `${write.kind}:#${write.number.toString()}@${write.branch}`;
    }).join(', ')}`;
}
function failureReason(error) {
    if (error instanceof UpdateDependenciesError)
        return `${error.code}: ${error.message}`;
    if (error instanceof Error)
        return error.message;
    return String(error);
}
function publicationError(message) {
    return actionError('ZOLT-PUBLISH-001', message);
}
async function waitFor(milliseconds) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

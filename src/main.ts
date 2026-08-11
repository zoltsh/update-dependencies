import { GitHubActionCore, type ActionCore } from './action/core.js';
import { createRepositoryView } from './environment/repository-state.js';
import { readExecutionContext } from './environment/context.js';
import { actionError } from './errors.js';
import { createGitHubRequester } from './github/api-client.js';
import { compactPreview, renderPullRequestPreview } from './github/preview.js';
import {
    publishManagedPullRequests,
    type ManagedPublicationRepository,
    type ManagedPublicationResult,
} from './github/publication.js';
import { GitHubRepositoryApi } from './github/repository-api.js';
import { renderSummary } from './github/summary.js';
import { isCanonicalDigestIdentifier } from './identifiers.js';
import { readInputs } from './inputs.js';
import { installZolt, type InstalledZolt } from './install/install-zolt.js';
import { managedTargetIdentity } from './planner/identity.js';
import { resolveTarget } from './install/platform.js';
import { planUpdates } from './planner/plan.js';
import { publicErrorMessage, publicJson, publicText, registeredSecrets } from './public-output.js';
import type { BlockedUpdate, PlannedUpdate, RepositoryView } from './types.js';
import { captureOutdated } from './zolt/commands.js';
import { createZoltEnvironment, type ZoltEnvironment } from './zolt/process.js';
import { selectZoltProject } from './zolt/workspace.js';

export interface ActionDependencies {
    readonly architecture?: string;
    readonly capture?: typeof captureOutdated;
    readonly core?: ActionCore;
    readonly createEnvironment?: typeof createZoltEnvironment;
    readonly createPublicationRepository?: (
        repository: string,
        token: string,
    ) => ManagedPublicationRepository;
    readonly createRepository?: typeof createRepositoryView;
    readonly environment?: NodeJS.ProcessEnv;
    readonly install?: typeof installZolt;
    readonly plan?: typeof planUpdates;
    readonly platform?: NodeJS.Platform;
    readonly publish?: typeof publishManagedPullRequests;
    readonly readContext?: typeof readExecutionContext;
    readonly selectProject?: typeof selectZoltProject;
}

export async function runAction(dependencies: ActionDependencies = {}): Promise<void> {
    const environment = dependencies.environment ?? process.env;
    const core = dependencies.core ?? new GitHubActionCore(environment);
    const secrets = new Set(registeredSecrets(environment));
    let installed: InstalledZolt | undefined;
    let repository: RepositoryView | undefined;
    let zoltEnvironment: ZoltEnvironment | undefined;

    const registerSecret = (value: string): void => {
        if (value === '') return;
        secrets.add(value);
        core.setSecret(value);
    };

    try {
        const inputs = readInputs(core, registerSecret);
        const execution = await (dependencies.readContext ?? readExecutionContext)(environment);
        const target = resolveTarget(
            dependencies.platform ?? process.platform,
            dependencies.architecture ?? process.arch,
        );
        repository = await (dependencies.createRepository ?? createRepositoryView)({
            directory: inputs.directory,
            expectedSha: execution.sha,
            workspace: execution.workspace,
        }, { environment });
        const selection = await (dependencies.selectProject ?? selectZoltProject)(repository, inputs.workspace);
        zoltEnvironment = await (dependencies.createEnvironment ?? createZoltEnvironment)(
            environment,
            inputs.registryEnv,
            inputs.githubToken,
            registerSecret,
        );
        installed = await (dependencies.install ?? installZolt)(target, { environment });
        const report = await (dependencies.capture ?? captureOutdated)(
            installed.binary,
            inputs,
            selection,
            zoltEnvironment.environment,
        );
        await repository.verify();
        const plan = (dependencies.plan ?? planUpdates)(report, selection, inputs);
        let publication: ManagedPublicationResult | undefined;
        let selected = plan.selected;
        if (!inputs.dryRun) {
            if (report.schemaVersion !== 2) {
                throw actionError('ZOLT-WRITE-001', 'Write mode requires authoritative Zolt schema v2 targets.');
            }
            const repositoryApi = (dependencies.createPublicationRepository
                ?? createProductionPublicationRepository)(execution.repository, inputs.githubToken);
            publication = await (dependencies.publish ?? publishManagedPullRequests)({
                baseSha: execution.sha,
                binary: installed.binary,
                branchGeneration: execution.publicationGeneration,
                defaultBranch: execution.defaultBranch,
                environment: zoltEnvironment.environment,
                includePrereleases: inputs.includePrereleases,
                openPullRequestsLimit: inputs.openPullRequestsLimit,
                repository,
                repositoryId: execution.repositoryId,
                retained: retainedManagedTargets(plan.blocked, selection.relativeRoot),
                selection,
                targets: plan.eligible,
            }, { repositoryApi });
            selected = publishedTargets(plan.eligible, publication);
        }
        const previews = selected.map((planned) => ({
            preview: renderPullRequestPreview(
                planned,
                inputs.dryRun ? execution.sha : execution.publicationGeneration,
            ),
            target: planned,
        }));
        const compact = previews.map(({ target: planned, preview }) => compactPreview(planned, preview));
        const writes = publication?.visibleWrites ?? [];
        const created = writes.filter(({ kind }) => kind === 'pull-request-created').length;
        const updated = writes.filter(({ kind }) => kind === 'pull-request-updated').length;
        const closed = writes.filter(({ kind }) => kind === 'pull-request-closed').length;
        const deferred = publication?.reconciliation.deferred.length ?? plan.deferred.length;
        const blocked = plan.blocked.length + (publication?.reconciliation.blocked.length ?? 0);

        await core.setOutput('planned-update-count', selected.length);
        await core.setOutput('deferred-update-count', deferred);
        await core.setOutput('blocked-update-count', blocked);
        await core.setOutput('plan', publicJson(compact, [...secrets]));
        await core.setOutput('created-pull-request-count', created);
        await core.setOutput('updated-pull-request-count', updated);
        await core.setOutput('closed-pull-request-count', closed);
        await core.setOutput('zolt-version', installed.version);
        const summary = renderSummary({
            execution,
            inputs,
            installed,
            plan,
            previews,
            ...(publication === undefined ? {} : { publication }),
            selection,
        });
        await core.writeSummary(publicText(summary, [...secrets]));
        core.info(
            `${inputs.dryRun ? 'Planned' : 'Managed'} ${selected.length.toString()} Zolt dependency update(s); `
            + `${deferred.toString()} deferred and ${blocked.toString()} blocked.`,
        );
    } catch (error) {
        core.setFailed(publicErrorMessage(error, [...secrets]));
    } finally {
        await cleanup('Zolt environment', zoltEnvironment?.cleanup, core, secrets);
        await cleanup('verified Zolt installation', installed?.cleanup, core, secrets);
        await cleanup('private repository view', repository?.cleanup, core, secrets);
    }
}

function createProductionPublicationRepository(
    repository: string,
    token: string,
): ManagedPublicationRepository {
    const [owner, name] = repository.split('/');
    if (owner === undefined || name === undefined) {
        throw actionError('ZOLT-GITHUB-001', 'The GitHub repository identity is invalid.');
    }
    return new GitHubRepositoryApi({
        owner,
        repository: name,
        requester: createGitHubRequester(token),
    });
}

function retainedManagedTargets(
    blocked: readonly BlockedUpdate[],
    zoltRoot: string,
): readonly { readonly managedId: string; readonly reason: string }[] {
    return blocked.flatMap((target) => {
        if (target.targetId === undefined || !isCanonicalDigestIdentifier(target.targetId, 'zt1_')) {
            return [];
        }
        return [{
            managedId: managedTargetIdentity(zoltRoot, target.targetId).managedId,
            reason: target.reason,
        }];
    });
}

function publishedTargets(
    eligible: readonly PlannedUpdate[],
    publication: ManagedPublicationResult,
): readonly PlannedUpdate[] {
    const selected = new Set([
        ...publication.reconciliation.create.map(({ target }) => target.managedId),
        ...publication.reconciliation.refresh.map(({ desired }) => desired.target.managedId),
        ...publication.reconciliation.unchanged.map(({ desired }) => desired.target.managedId),
    ]);
    return eligible.filter(({ managedId }) => selected.has(managedId));
}

async function cleanup(
    label: string,
    operation: (() => Promise<void>) | undefined,
    core: ActionCore,
    secrets: ReadonlySet<string>,
): Promise<void> {
    if (operation === undefined) return;
    try {
        await operation();
    } catch (error) {
        core.setFailed(`ZOLT-CLEANUP-001: Could not remove ${label}: ${publicErrorMessage(error, [...secrets])}`);
    }
}

import { GitHubActionCore, type ActionCore } from './action/core.js';
import { createRepositoryView } from './environment/repository-state.js';
import { readExecutionContext } from './environment/context.js';
import { actionError } from './errors.js';
import { compactPreview, renderPullRequestPreview } from './github/preview.js';
import { renderSummary } from './github/summary.js';
import { readInputs } from './inputs.js';
import { installZolt, type InstalledZolt } from './install/install-zolt.js';
import { resolveTarget } from './install/platform.js';
import { planUpdates } from './planner/plan.js';
import { publicErrorMessage, publicJson, publicText, registeredSecrets } from './public-output.js';
import type { RepositoryView } from './types.js';
import { captureOutdated } from './zolt/commands.js';
import { createZoltEnvironment, type ZoltEnvironment } from './zolt/process.js';
import { selectZoltProject } from './zolt/workspace.js';

export interface ActionDependencies {
    readonly architecture?: string;
    readonly capture?: typeof captureOutdated;
    readonly core?: ActionCore;
    readonly createEnvironment?: typeof createZoltEnvironment;
    readonly createRepository?: typeof createRepositoryView;
    readonly environment?: NodeJS.ProcessEnv;
    readonly install?: typeof installZolt;
    readonly plan?: typeof planUpdates;
    readonly platform?: NodeJS.Platform;
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
        if (!inputs.dryRun) {
            throw actionError(
                'ZOLT-WRITE-001',
                'This implementation batch is planning-only. Set dry-run to true until Zolt publishes its canonical exact-target update contract.',
            );
        }
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
        const previews = plan.selected.map((planned) => ({
            preview: renderPullRequestPreview(planned),
            target: planned,
        }));
        const compact = previews.map(({ target: planned, preview }) => compactPreview(planned, preview));

        await core.setOutput('planned-update-count', plan.selected.length);
        await core.setOutput('deferred-update-count', plan.deferred.length);
        await core.setOutput('blocked-update-count', plan.blocked.length);
        await core.setOutput('plan', publicJson(compact, [...secrets]));
        await core.setOutput('created-pull-request-count', 0);
        await core.setOutput('updated-pull-request-count', 0);
        await core.setOutput('closed-pull-request-count', 0);
        await core.setOutput('zolt-version', installed.version);
        const summary = renderSummary({ execution, inputs, installed, plan, previews, selection });
        await core.writeSummary(publicText(summary, [...secrets]));
        core.info(
            `Planned ${plan.selected.length.toString()} Zolt dependency update(s); `
            + `${plan.deferred.length.toString()} deferred and ${plan.blocked.length.toString()} blocked.`,
        );
    } catch (error) {
        core.setFailed(publicErrorMessage(error, [...secrets]));
    } finally {
        await cleanup('Zolt environment', zoltEnvironment?.cleanup, core, secrets);
        await cleanup('verified Zolt installation', installed?.cleanup, core, secrets);
        await cleanup('private repository view', repository?.cleanup, core, secrets);
    }
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

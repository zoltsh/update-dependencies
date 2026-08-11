import { GitHubActionCore } from './action/core.js';
import { createRepositoryView } from './environment/repository-state.js';
import { readExecutionContext } from './environment/context.js';
import { actionError } from './errors.js';
import { compactPreview, renderPullRequestPreview } from './github/preview.js';
import { renderSummary } from './github/summary.js';
import { readInputs } from './inputs.js';
import { installZolt } from './install/install-zolt.js';
import { resolveTarget } from './install/platform.js';
import { planUpdates } from './planner/plan.js';
import { publicErrorMessage, publicJson, publicText, registeredSecrets } from './public-output.js';
import { captureOutdated } from './zolt/commands.js';
import { createZoltEnvironment } from './zolt/process.js';
import { selectZoltProject } from './zolt/workspace.js';
export async function runAction(dependencies = {}) {
    const environment = dependencies.environment ?? process.env;
    const core = dependencies.core ?? new GitHubActionCore(environment);
    const secrets = new Set(registeredSecrets(environment));
    let installed;
    let repository;
    let zoltEnvironment;
    const registerSecret = (value) => {
        if (value === '')
            return;
        secrets.add(value);
        core.setSecret(value);
    };
    try {
        const inputs = readInputs(core, registerSecret);
        const execution = await (dependencies.readContext ?? readExecutionContext)(environment);
        if (!inputs.dryRun) {
            throw actionError('ZOLT-WRITE-001', 'Write mode remains closed while the pinned schema-v2 release and dormant publication orchestrator complete live publication canaries and explicit Action wiring. Set dry-run to true.');
        }
        const target = resolveTarget(dependencies.platform ?? process.platform, dependencies.architecture ?? process.arch);
        repository = await (dependencies.createRepository ?? createRepositoryView)({
            directory: inputs.directory,
            expectedSha: execution.sha,
            workspace: execution.workspace,
        }, { environment });
        const selection = await (dependencies.selectProject ?? selectZoltProject)(repository, inputs.workspace);
        zoltEnvironment = await (dependencies.createEnvironment ?? createZoltEnvironment)(environment, inputs.registryEnv, inputs.githubToken, registerSecret);
        installed = await (dependencies.install ?? installZolt)(target, { environment });
        const report = await (dependencies.capture ?? captureOutdated)(installed.binary, inputs, selection, zoltEnvironment.environment);
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
        core.info(`Planned ${plan.selected.length.toString()} Zolt dependency update(s); `
            + `${plan.deferred.length.toString()} deferred and ${plan.blocked.length.toString()} blocked.`);
    }
    catch (error) {
        core.setFailed(publicErrorMessage(error, [...secrets]));
    }
    finally {
        await cleanup('Zolt environment', zoltEnvironment?.cleanup, core, secrets);
        await cleanup('verified Zolt installation', installed?.cleanup, core, secrets);
        await cleanup('private repository view', repository?.cleanup, core, secrets);
    }
}
async function cleanup(label, operation, core, secrets) {
    if (operation === undefined)
        return;
    try {
        await operation();
    }
    catch (error) {
        core.setFailed(`ZOLT-CLEANUP-001: Could not remove ${label}: ${publicErrorMessage(error, [...secrets])}`);
    }
}

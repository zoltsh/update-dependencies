import { ZOLT_SOURCE_COMMIT } from '../generated/zolt-release.js';
import type { ActionInputs } from '../inputs.js';
import type { ExecutionContext } from '../environment/context.js';
import type { InstalledZolt } from '../install/install-zolt.js';
import type { PullRequestPreview, UpdatePlan, ZoltProjectSelection } from '../types.js';

export interface SummaryContext {
    readonly execution: ExecutionContext;
    readonly inputs: ActionInputs;
    readonly installed: InstalledZolt;
    readonly plan: UpdatePlan;
    readonly previews: readonly {
        readonly preview: PullRequestPreview;
        readonly target: UpdatePlan['selected'][number];
    }[];
    readonly selection: ZoltProjectSelection;
}

export function renderSummary(context: SummaryContext): string {
    const selected = context.previews.map(({ target, preview }) =>
        `| \`${escapeCell(target.manifestPath)}\` | \`${escapeCell(target.identifier)}\` | \`${escapeCell(target.currentVersion)}\` → \`${escapeCell(target.targetVersion)}\` | ${target.changeClass} | \`${escapeCell(preview.branch)}\` |`,
    );
    const deferred = context.plan.deferred.map((target) =>
        `| \`${escapeCell(target.manifestPath)}\` | \`${escapeCell(target.identifier)}\` | \`${escapeCell(target.currentVersion)}\` → \`${escapeCell(target.targetVersion)}\` | ${target.changeClass} |`,
    );
    const blocked = context.plan.blocked.map((target) =>
        `| \`${escapeCell(target.manifestPath)}\` | \`${escapeCell(target.identifier)}\` | ${escapeCell(target.reason)} |`,
    );
    const outside = context.plan.outsidePolicy.map((target) =>
        `| \`${escapeCell(target.manifestPath)}\` | \`${escapeCell(target.identifier)}\` | ${escapeCell(target.reason)} |`,
    );
    const diagnostics = context.plan.diagnostics.map((message) => `- ${escapeCell(message)}`);
    const authoritative = context.plan.selected.filter((target) => target.authoritativeTarget).length;
    return `# Zolt dependency update plan

> Planning preview: no branches or pull requests were written.

- Repository: \`${escapeCell(context.execution.repository)}\`
- Base: \`${escapeCell(context.execution.defaultBranch)}\` at \`${context.execution.sha}\`
- Selection: ${context.selection.mode} at \`${escapeCell(context.selection.relativeRoot)}\`
- Zolt: \`${escapeCell(context.installed.version)}\` from \`${ZOLT_SOURCE_COMMIT}\`
- Policy: ${context.inputs.updateCeiling}, prereleases ${context.inputs.includePrereleases ? 'enabled' : 'disabled'}, limit ${context.inputs.openPullRequestsLimit.toString()}
- Identity: ${authoritative.toString()} authoritative schema-v2 target(s), ${(context.plan.selected.length - authoritative).toString()} provisional schema-v1 target(s)

## Selected (${context.plan.selected.length.toString()})

${table(
        '| Manifest | Dependency or alias | Version | Class | Managed branch preview |\n| :--- | :--- | :--- | :---: | :--- |',
        selected,
        '_No updates were selected._',
    )}

## Deferred by limit (${context.plan.deferred.length.toString()})

${table(
        '| Manifest | Dependency or alias | Version | Class |\n| :--- | :--- | :--- | :---: |',
        deferred,
        '_No eligible updates were deferred._',
    )}

## Blocked (${context.plan.blocked.length.toString()})

${table(
        '| Manifest | Dependency or alias | Reason |\n| :--- | :--- | :--- |',
        blocked,
        '_No update surfaces were blocked._',
    )}

## Outside selected ceiling (${context.plan.outsidePolicy.length.toString()})

${table(
        '| Manifest | Dependency or alias | Reason |\n| :--- | :--- | :--- |',
        outside,
        '_No available updates were excluded by the selected ceiling._',
    )}

${diagnostics.length === 0 ? '' : `## Zolt diagnostics\n\n${diagnostics.join('\n')}\n\n`}The exact-update artifact executor and managed-PR reconciliation kernel are implemented, but publication remains disabled until a matching Zolt schema-v2 release and the publication orchestrator are enabled together.
`;
}

function table(header: string, rows: readonly string[], empty: string): string {
    return rows.length === 0 ? empty : `${header}\n${rows.join('\n')}`;
}

function escapeCell(value: string): string {
    return value
        .replaceAll('\\', '\\\\')
        .replaceAll('`', '\\`')
        .replaceAll('|', '\\|')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('\r', ' ')
        .replaceAll('\n', ' ');
}

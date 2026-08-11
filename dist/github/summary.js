import { ZOLT_SOURCE_COMMIT } from '../generated/zolt-release.js';
export function renderSummary(context) {
    const selected = context.previews.map(({ target, preview }) => `| \`${escapeCell(target.manifestPath)}\` | \`${escapeCell(target.identifier)}\` | \`${escapeCell(target.currentVersion)}\` → \`${escapeCell(target.targetVersion)}\` | ${target.changeClass} | \`${escapeCell(preview.branch)}\` |`);
    const deferredTargets = context.publication === undefined
        ? context.plan.deferred
        : context.publication.reconciliation.deferred.map(({ target }) => target);
    const deferred = deferredTargets.map((target) => `| \`${escapeCell(target.manifestPath)}\` | \`${escapeCell(target.identifier)}\` | \`${escapeCell(target.currentVersion)}\` → \`${escapeCell(target.targetVersion)}\` | ${target.changeClass} |`);
    const blocked = context.plan.blocked.map((target) => `| \`${escapeCell(target.manifestPath)}\` | \`${escapeCell(target.identifier)}\` | ${escapeCell(target.reason)} |`);
    const outside = context.plan.outsidePolicy.map((target) => `| \`${escapeCell(target.manifestPath)}\` | \`${escapeCell(target.identifier)}\` | ${escapeCell(target.reason)} |`);
    const diagnostics = context.plan.diagnostics.map((message) => `- ${escapeCell(message)}`);
    const authoritative = context.previews.filter(({ target }) => target.authoritativeTarget).length;
    const publicationBlockers = context.publication?.reconciliation.blocked.map(({ existing, reason }) => `| #${existing.number.toString()} | \`${escapeCell(existing.branch)}\` | ${escapeCell(reason)} |`) ?? [];
    return `# Zolt dependency updates

${publicationStatus(context.publication)}

- Repository: \`${escapeCell(context.execution.repository)}\`
- Base: \`${escapeCell(context.execution.defaultBranch)}\` at \`${context.execution.sha}\`
- Selection: ${context.selection.mode} at \`${escapeCell(context.selection.relativeRoot)}\`
- Zolt: \`${escapeCell(context.installed.version)}\` from \`${ZOLT_SOURCE_COMMIT}\`
- Policy: ${context.inputs.updateCeiling}, prereleases ${context.inputs.includePrereleases ? 'enabled' : 'disabled'}, limit ${context.inputs.openPullRequestsLimit.toString()}
- Identity: ${authoritative.toString()} authoritative schema-v2 target(s), ${(context.previews.length - authoritative).toString()} provisional schema-v1 target(s)

## Selected (${context.previews.length.toString()})

${table('| Manifest | Dependency or alias | Version | Class | Managed branch preview |\n| :--- | :--- | :--- | :---: | :--- |', selected, '_No updates were selected._')}

## Deferred by limit (${deferredTargets.length.toString()})

${table('| Manifest | Dependency or alias | Version | Class |\n| :--- | :--- | :--- | :---: |', deferred, '_No eligible updates were deferred._')}

## Blocked (${context.plan.blocked.length.toString()})

${table('| Manifest | Dependency or alias | Reason |\n| :--- | :--- | :--- |', blocked, '_No update surfaces were blocked._')}

## Outside selected ceiling (${context.plan.outsidePolicy.length.toString()})

${table('| Manifest | Dependency or alias | Reason |\n| :--- | :--- | :--- |', outside, '_No available updates were excluded by the selected ceiling._')}

${context.publication === undefined ? '' : `## Managed pull request blockers (${publicationBlockers.length.toString()})

${table('| Pull request | Branch | Reason |\n| :---: | :--- | :--- |', publicationBlockers, '_No managed pull requests were blocked._')}

`}${diagnostics.length === 0 ? '' : `## Zolt diagnostics\n\n${diagnostics.join('\n')}\n\n`}${publicationFooter(context.publication)}
`;
}
function publicationStatus(publication) {
    if (publication === undefined)
        return '> Planning preview: no branches or pull requests were written.';
    const writes = publication.visibleWrites;
    const created = writes.filter(({ kind }) => kind === 'pull-request-created').length;
    const updated = writes.filter(({ kind }) => kind === 'pull-request-updated').length;
    const closed = writes.filter(({ kind }) => kind === 'pull-request-closed').length;
    return `> Managed publication complete: ${created.toString()} created, ${updated.toString()} refreshed, and ${closed.toString()} closed.`;
}
function publicationFooter(publication) {
    return publication === undefined
        ? 'Set `dry-run: false` to create and reconcile managed dependency pull requests.'
        : 'Every published branch was built from an isolated exact-commit copy and passed locked offline verification before GitHub writes.';
}
function table(header, rows, empty) {
    return rows.length === 0 ? empty : `${header}\n${rows.join('\n')}`;
}
function escapeCell(value) {
    return value
        .replaceAll('\\', '\\\\')
        .replaceAll('`', '\\`')
        .replaceAll('|', '\\|')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('\r', ' ')
        .replaceAll('\n', ' ');
}

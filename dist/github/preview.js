import { branchSlug } from '../planner/identity.js';
export function renderPullRequestPreview(target) {
    const branch = `zolt/update/${branchSlug(target.identifier)}-${target.branchHash}`;
    const title = truncate(`build(deps): bump ${target.identifier} from ${target.currentVersion} to ${target.targetVersion}`, 240);
    const markerPayload = Buffer.from(JSON.stringify({
        manifestPath: target.manifestPath,
        provisionalTargetId: target.provisionalTargetId,
    }), 'utf8').toString('base64url');
    const marker = `<!-- zolt-update-dependencies:preview-v1:${markerPayload} -->`;
    const fanOut = target.fanOut.length === 0
        ? '_This target changes one literal version surface._'
        : target.fanOut.map((value) => `- \`${escapeCode(value)}\``).join('\n');
    const members = target.members.length === 0
        ? '_No cross-member attribution was reported._'
        : target.members.map((value) => `- \`${escapeCode(value)}\``).join('\n');
    const body = `## Zolt dependency update

| | |
| :--- | :--- |
| Manifest | \`${escapeCode(target.manifestPath)}\` |
| Root lock | \`${escapeCode(target.lockfilePath)}\` |
| Surface | \`${escapeCode(target.surface)}\` in \`${escapeCode(target.section)}\` |
| Version | \`${escapeCode(target.currentVersion)}\` → \`${escapeCode(target.targetVersion)}\` |
| Update class | ${target.changeClass} |
| Preview target | \`${target.provisionalTargetId}\` |

### Fan-out

${fanOut}

### Workspace attribution

${members}

### Verification boundary

This is a deterministic planning preview. The action will not create this branch until Zolt exposes an authoritative exact-target update contract and reports the exact changed files after workspace-safe lock regeneration.

${marker}
`;
    return Object.freeze({ body, branch, marker, title });
}
export function compactPreview(target, preview) {
    return Object.freeze({
        branch: preview.branch,
        changeClass: target.changeClass,
        fanOut: target.fanOut,
        from: target.currentVersion,
        identifier: target.identifier,
        lockfilePath: target.lockfilePath,
        manifestPath: target.manifestPath,
        members: target.members,
        section: target.section,
        surface: target.surface,
        provisionalTargetId: target.provisionalTargetId,
        title: preview.title,
        to: target.targetVersion,
    });
}
function truncate(value, maximum) {
    return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}
function escapeCode(value) {
    return value.replaceAll('`', '\\`');
}

import { branchSlug } from '../planner/identity.js';
import type { CompactPlanItem, PlannedUpdate, PullRequestPreview } from '../types.js';

export function renderPullRequestPreview(target: PlannedUpdate): PullRequestPreview {
    const branch = `zolt/update/${branchSlug(target.identifier)}-${target.branchHash}`;
    const title = truncate(
        `build(deps): bump ${target.identifier} from ${target.currentVersion} to ${target.targetVersion}`,
        240,
    );
    const markerPayload = Buffer.from(JSON.stringify({
        authoritativeTarget: target.authoritativeTarget,
        lockfilePath: target.lockfilePath,
        managedId: target.managedId,
        manifestPath: target.manifestPath,
        targetId: target.targetId,
        zoltRoot: target.zoltRoot,
    }), 'utf8').toString('base64url');
    const marker = `<!-- zolt-update-dependencies:preview-v2:${markerPayload} -->`;
    const fanOut = target.fanOut.length === 0
        ? '_This target changes one literal version surface._'
        : target.fanOut.map((value) => `- \`${escapeCode(value)}\``).join('\n');
    const members = target.members.length === 0
        ? '_No cross-member attribution was reported._'
        : target.members.map((value) => `- \`${escapeCode(value)}\``).join('\n');
    const identityLabel = target.authoritativeTarget ? 'Zolt target' : 'Preview target';
    const verification = target.authoritativeTarget
        ? 'Zolt supplied the canonical target identity and manifest/root-lock paths. The isolated exact-update executor is available; publication remains disabled until a matching pinned Zolt release and the publication orchestrator are enabled together.'
        : 'This target came from schema v1. The action will not execute it until the pinned Zolt release supplies canonical schema-v2 identity and paths.';
    const body = `## Zolt dependency update

| | |
| :--- | :--- |
| Manifest | \`${escapeCode(target.manifestPath)}\` |
| Root lock | \`${escapeCode(target.lockfilePath)}\` |
| Surface | \`${escapeCode(target.surface)}\` in \`${escapeCode(target.section)}\` |
| Version | \`${escapeCode(target.currentVersion)}\` → \`${escapeCode(target.targetVersion)}\` |
| Update class | ${target.changeClass} |
| ${identityLabel} | \`${target.targetId}\` |
| Managed identity | \`${target.managedId}\` |

### Fan-out

${fanOut}

### Workspace attribution

${members}

### Verification boundary

${verification}

${marker}
`;
    return Object.freeze({ body, branch, marker, title });
}

export function compactPreview(target: PlannedUpdate, preview: PullRequestPreview): CompactPlanItem {
    return Object.freeze({
        authoritativeTarget: target.authoritativeTarget,
        branch: preview.branch,
        changeClass: target.changeClass,
        fanOut: target.fanOut,
        from: target.currentVersion,
        identifier: target.identifier,
        lockfilePath: target.lockfilePath,
        managedId: target.managedId,
        manifestPath: target.manifestPath,
        members: target.members,
        section: target.section,
        surface: target.surface,
        targetId: target.targetId,
        title: preview.title,
        to: target.targetVersion,
        zoltRoot: target.zoltRoot,
    });
}

function truncate(value: string, maximum: number): string {
    return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function escapeCode(value: string): string {
    return value.replaceAll('`', '\\`');
}

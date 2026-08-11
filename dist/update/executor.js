import { lstat, readFile } from 'node:fs/promises';
import { MAX_UPDATE_ARTIFACT_BYTES } from '../constants.js';
import { actionError } from '../errors.js';
import { isCanonicalDigestIdentifier } from '../identifiers.js';
import { canonicalZoltManifestPath, canonicalZoltRootLockPath, containedFile, containedRoot, joinRelativeRoot, } from '../paths.js';
import { runExactUpdate, verifyLockedOffline } from '../zolt/commands.js';
export async function prepareExactUpdateArtifact(input, dependencies = {}) {
    requireAuthoritativeTarget(input.target, input.selection);
    await input.repository.verify();
    const copy = await input.repository.createMutableCopy();
    try {
        const zoltRoot = containedRoot(copy.workspace, input.target.zoltRoot, 'selected Zolt root');
        const result = await (dependencies.exactUpdate ?? runExactUpdate)(input.binary, zoltRoot, input.environment, {
            includePrereleases: input.includePrereleases,
            targetId: input.target.targetId,
            toVersion: input.target.targetVersion,
        });
        validateExactResult(result, input.target);
        const afterUpdate = await copy.inspectChanges();
        const changedFiles = validateChanges(afterUpdate, result, input.target);
        const filesBeforeVerification = await readArtifactFiles(copy.workspace, changedFiles);
        await (dependencies.verify ?? verifyLockedOffline)(input.binary, { mode: input.target.zoltMode }, zoltRoot, input.environment);
        const afterVerification = await copy.inspectChanges();
        requireSameChanges(afterUpdate, afterVerification);
        const files = await readArtifactFiles(copy.workspace, changedFiles);
        requireSameFiles(filesBeforeVerification, files);
        return Object.freeze({
            changedFiles: Object.freeze(changedFiles),
            files: Object.freeze(files),
            result,
            target: input.target,
        });
    }
    finally {
        try {
            await copy.cleanup();
        }
        finally {
            await input.repository.verify();
        }
    }
}
function requireAuthoritativeTarget(target, selection) {
    if (!target.authoritativeTarget || !isCanonicalDigestIdentifier(target.targetId, 'zt1_')) {
        throw actionError('ZOLT-EXECUTE-001', 'Exact update execution requires an authoritative schema-v2 Zolt target.');
    }
    const zoltManifestPath = canonicalZoltManifestPath(target.zoltManifestPath, 'planned Zolt manifest path');
    const zoltLockfilePath = canonicalZoltRootLockPath(target.zoltLockfilePath, 'planned Zolt lockfile path');
    if (target.zoltRoot !== selection.relativeRoot
        || target.lockfilePath !== selection.lockfilePath
        || joinRelativeRoot(target.zoltRoot, zoltManifestPath, 'planned manifest path')
            !== target.manifestPath
        || joinRelativeRoot(target.zoltRoot, zoltLockfilePath, 'planned lockfile path')
            !== target.lockfilePath) {
        throw actionError('ZOLT-EXECUTE-001', 'The exact update target does not belong to the selected Zolt mutation root.');
    }
}
function validateExactResult(result, target) {
    const mismatches = [];
    compare(mismatches, 'targetId', result.target.targetId, target.targetId);
    compare(mismatches, 'manifestPath', result.target.manifestPath, target.zoltManifestPath);
    compare(mismatches, 'lockfilePath', result.target.lockfilePath, target.zoltLockfilePath);
    compare(mismatches, 'surface', result.target.surface, target.surface);
    compare(mismatches, 'identifier', result.target.identifier, target.identifier);
    compare(mismatches, 'section', result.target.section, target.section);
    compare(mismatches, 'from', result.from, target.currentVersion);
    compare(mismatches, 'to', result.to, target.targetVersion);
    compare(mismatches, 'class', result.changeClass, target.changeClass);
    if (!sameStrings(result.fanOut, target.fanOut))
        mismatches.push('fanOut');
    if (result.dryRun || !result.changed || !result.applied || !result.resolved) {
        mismatches.push('applied exact-update state');
    }
    if (mismatches.length !== 0) {
        throw actionError('ZOLT-EXECUTE-002', `Zolt exact-update result did not match the selected target: ${mismatches.join(', ')}.`);
    }
}
function validateChanges(changes, result, target) {
    if (changes.deleted.length !== 0
        || changes.modeChanged.length !== 0
        || changes.missingDirectories.length !== 0) {
        throw actionError('ZOLT-EXECUTE-003', 'Zolt exact update deleted entries or changed file modes.');
    }
    if (changes.added.some((path) => path !== target.lockfilePath)) {
        throw actionError('ZOLT-EXECUTE-003', 'Zolt exact update changed a file outside its manifest/root-lock boundary.');
    }
    const allowed = new Set([target.manifestPath, target.lockfilePath]);
    if (changes.paths.some((path) => !allowed.has(path))) {
        throw actionError('ZOLT-EXECUTE-003', 'Zolt exact update changed a file outside its manifest/root-lock boundary.');
    }
    if (!changes.paths.includes(target.manifestPath)) {
        throw actionError('ZOLT-EXECUTE-003', 'Zolt exact update did not change the selected manifest.');
    }
    const reported = result.changedFiles.map((path) => joinRelativeRoot(target.zoltRoot, path, 'Zolt-reported changed file'));
    const expectedOrder = [target.manifestPath, target.lockfilePath]
        .filter((path) => changes.paths.includes(path));
    if (!sameStrings(reported, expectedOrder)) {
        throw actionError('ZOLT-EXECUTE-004', 'Zolt-reported changed files did not exactly match the independently observed manifest/root-lock changes.');
    }
    return expectedOrder;
}
async function readArtifactFiles(workspace, paths) {
    const files = [];
    for (const path of paths) {
        const absolute = containedFile(workspace, path, 'update artifact path');
        const info = await lstat(absolute);
        if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_UPDATE_ARTIFACT_BYTES) {
            throw actionError('ZOLT-EXECUTE-005', `Update artifact ${path} is not a bounded regular file.`);
        }
        files.push(Object.freeze({
            content: Buffer.from(await readFile(absolute)),
            mode: (info.mode & 0o111) === 0 ? '100644' : '100755',
            path,
        }));
    }
    return files;
}
function requireSameChanges(before, after) {
    const fileChanges = (changes) => ({
        added: changes.added,
        deleted: changes.deleted,
        missingDirectories: changes.missingDirectories,
        modeChanged: changes.modeChanged,
        modified: changes.modified,
        paths: changes.paths,
    });
    if (JSON.stringify(fileChanges(before)) !== JSON.stringify(fileChanges(after))) {
        throw actionError('ZOLT-EXECUTE-006', 'Locked offline verification changed the prepared update artifact.');
    }
}
function requireSameFiles(before, after) {
    if (before.length !== after.length
        || before.some((file, index) => {
            const compared = after[index];
            return compared === undefined
                || file.path !== compared.path
                || file.mode !== compared.mode
                || !file.content.equals(compared.content);
        })) {
        throw actionError('ZOLT-EXECUTE-006', 'Locked offline verification changed the prepared update artifact.');
    }
}
function compare(mismatches, label, actual, expected) {
    if (actual !== expected)
        mismatches.push(label);
}
function sameStrings(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

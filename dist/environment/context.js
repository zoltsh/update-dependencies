import { lstat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { actionError } from '../errors.js';
const MAX_EVENT_BYTES = 1024 * 1024;
const ALLOWED_EVENTS = new Set(['push', 'schedule', 'workflow_dispatch']);
export async function readExecutionContext(environment, readEvent = readEventFile) {
    if (environment.GITHUB_ACTIONS !== 'true') {
        throw actionError('ZOLT-EVENT-001', 'This command must run as a GitHub Action.');
    }
    if (environment.GITHUB_SERVER_URL !== undefined && environment.GITHUB_SERVER_URL !== 'https://github.com') {
        throw actionError('ZOLT-EVENT-011', 'GitHub Enterprise Server is not supported.');
    }
    const eventName = required(environment.GITHUB_EVENT_NAME, 'GITHUB_EVENT_NAME');
    if (!ALLOWED_EVENTS.has(eventName)) {
        throw actionError('ZOLT-EVENT-002', `Event ${eventName} is not supported. Run on schedule, workflow_dispatch, or a default-branch push.`);
    }
    const eventPath = required(environment.GITHUB_EVENT_PATH, 'GITHUB_EVENT_PATH');
    const raw = await readEvent(eventPath);
    if (Buffer.byteLength(raw) > MAX_EVENT_BYTES)
        throw actionError('ZOLT-EVENT-003', 'The GitHub event payload is too large.');
    let payload;
    try {
        payload = JSON.parse(raw);
    }
    catch (error) {
        throw actionError('ZOLT-EVENT-004', 'Could not parse the GitHub event payload.', error);
    }
    const repository = required(environment.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
        throw actionError('ZOLT-EVENT-005', 'GITHUB_REPOSITORY is invalid.');
    }
    if (payload.repository?.full_name !== repository) {
        throw actionError('ZOLT-EVENT-006', 'The event repository does not match GITHUB_REPOSITORY.');
    }
    const repositoryId = positiveSafeInteger(payload.repository?.id, 'repository.id');
    const runId = decimalIdentifier(environment.GITHUB_RUN_ID, 'GITHUB_RUN_ID');
    const runAttempt = decimalIdentifier(environment.GITHUB_RUN_ATTEMPT, 'GITHUB_RUN_ATTEMPT');
    const defaultBranch = stringValue(payload.repository?.default_branch, 'repository.default_branch');
    const ref = required(environment.GITHUB_REF, 'GITHUB_REF');
    const expectedRef = `refs/heads/${defaultBranch}`;
    if (ref !== expectedRef || payload.ref !== undefined && payload.ref !== expectedRef) {
        throw actionError('ZOLT-EVENT-007', `Run this action only from the default branch ${defaultBranch}.`);
    }
    const sha = required(environment.GITHUB_SHA, 'GITHUB_SHA');
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(sha)) {
        throw actionError('ZOLT-EVENT-008', 'GITHUB_SHA must be a full 40- or 64-character commit SHA.');
    }
    return {
        defaultBranch,
        eventName: eventName,
        ref,
        repository,
        repositoryId,
        publicationGeneration: createHash('sha256')
            .update('zolt-update-dependencies-publication-generation-v1\0', 'utf8')
            .update(runId, 'utf8')
            .update('\0', 'utf8')
            .update(runAttempt, 'utf8')
            .digest('hex'),
        sha: sha.toLowerCase(),
        workspace: required(environment.GITHUB_WORKSPACE, 'GITHUB_WORKSPACE'),
    };
}
async function readEventFile(path) {
    let info;
    try {
        info = await lstat(path);
    }
    catch (error) {
        throw actionError('ZOLT-EVENT-012', 'Could not inspect GITHUB_EVENT_PATH.', error);
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_EVENT_BYTES) {
        throw actionError('ZOLT-EVENT-012', 'GITHUB_EVENT_PATH must be a bounded regular file.');
    }
    return readFile(path, 'utf8');
}
function required(value, name) {
    if (value === undefined || value.trim() === '')
        throw actionError('ZOLT-EVENT-009', `${name} is not set.`);
    return value;
}
function stringValue(value, name) {
    if (typeof value !== 'string' || value.trim() === '')
        throw actionError('ZOLT-EVENT-010', `${name} is missing.`);
    return value;
}
function positiveSafeInteger(value, name) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw actionError('ZOLT-EVENT-010', `${name} is missing or invalid.`);
    }
    return value.toString();
}
function decimalIdentifier(value, name) {
    const identifier = required(value, name);
    if (!/^[1-9][0-9]{0,39}$/u.test(identifier)) {
        throw actionError('ZOLT-EVENT-010', `${name} is invalid.`);
    }
    return identifier;
}

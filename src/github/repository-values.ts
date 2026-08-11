import { MAX_UPDATE_ARTIFACT_BYTES } from '../constants.js';
import { actionError } from '../errors.js';
import { canonicalRelativeFile } from '../paths.js';
import type { UpdateArtifactFile } from '../types.js';
import type { ExistingPullRequest } from './reconcile.js';

const FULL_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const GENERATED_BRANCH_PATTERN = /^zolt\/update\/[a-z0-9](?:[a-z0-9-]{0,41}[a-z0-9])?-[0-9a-f]{10}-[0-9a-f]{10}$/u;
const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/u;
const MAX_PULL_REQUEST_BODY_BYTES = 128 * 1024;

export function canonicalCommitFiles(
    files: readonly UpdateArtifactFile[],
): readonly UpdateArtifactFile[] {
    if (files.length === 0 || files.length > 2) {
        throw githubRepositoryError('A managed update commit requires one or two changed files.');
    }
    const seen = new Set<string>();
    return Object.freeze(files.map((file) => {
        const path = canonicalRelativeFile(file.path, 'update commit path');
        if (seen.has(path)) throw githubRepositoryError(`Duplicate update commit path ${path}.`);
        seen.add(path);
        if (file.mode !== '100644' && file.mode !== '100755') {
            throw githubRepositoryError(`Unsupported Git mode for ${path}.`);
        }
        if (file.content.length > MAX_UPDATE_ARTIFACT_BYTES) {
            throw githubRepositoryError(`Update commit path ${path} is too large.`);
        }
        return Object.freeze({ content: Buffer.from(file.content), mode: file.mode, path });
    }));
}

export function decodeOpenPullRequests(
    value: unknown,
    maximumPageSize: number,
): readonly ExistingPullRequest[] {
    if (!Array.isArray(value) || value.length > maximumPageSize) {
        throw githubRepositoryError('GitHub returned an invalid open pull request page.');
    }
    return value.map((entry) => {
        const object = record(entry, 'open pull request');
        const head = record(object.head, 'pull request head');
        const base = record(object.base, 'pull request base');
        const repository = head.repo === null ? null : record(head.repo, 'pull request head repository');
        return Object.freeze({
            baseBranch: safeBranchName(
                stringField(base.ref, 'pull request base ref'),
                'pull request base ref',
            ),
            body: responseBody(object.body),
            branch: safeBranchName(
                stringField(head.ref, 'pull request head ref'),
                'pull request head ref',
            ),
            headRepositoryId: repository === null ? '' : String(positiveNumber(repository.id, 'repository id')),
            headSha: fullSha(stringField(head.sha, 'pull request head SHA'), 'pull request head SHA'),
            number: positiveNumber(object.number, 'pull request number'),
        });
    });
}

export function decodePullRequestNumber(value: unknown): number {
    return positiveNumber(record(value, 'pull request').number, 'pull request number');
}

export function decodeObjectSha(value: unknown, label: string): string {
    return fullSha(stringField(record(value, label).sha, `${label} SHA`), `${label} SHA`);
}

export function decodeNestedSha(
    value: unknown,
    keys: readonly string[],
    label: string,
): string {
    let current = value;
    for (const key of keys) current = record(current, label)[key];
    return fullSha(stringField(current, `${label} SHA`), `${label} SHA`);
}

export function repositoryName(value: string, label: string): string {
    if (
        !NAME_PATTERN.test(value)
        || value.length > 100
        || value === '.'
        || value === '..'
    ) {
        throw githubRepositoryError(`The GitHub repository ${label} is invalid.`);
    }
    return value;
}

export function generatedBranch(value: string): string {
    if (!GENERATED_BRANCH_PATTERN.test(value)) {
        throw githubRepositoryError('The managed branch name is invalid.');
    }
    return value;
}

export function generatedBranchPath(value: string): string {
    return generatedBranch(value).split('/').map(encodeURIComponent).join('/');
}

export function safeBranchName(value: string, label: string): string {
    const components = value.split('/');
    if (
        value === ''
        || value === '@'
        || value.length > 255
        || value.startsWith('/')
        || value.endsWith('/')
        || value.includes('//')
        || value.includes('..')
        || value.includes('@{')
        || /[\u0000-\u0020~^:?*[\\\u007f]/u.test(value)
        || components.some((component) =>
            component === ''
            || component.startsWith('.')
            || component.endsWith('.')
            || component.endsWith('.lock'))
    ) {
        throw githubRepositoryError(`The ${label} is invalid.`);
    }
    return value;
}

export function fullSha(value: string, label: string): string {
    if (!FULL_SHA_PATTERN.test(value)) throw githubRepositoryError(`The ${label} is invalid.`);
    return value;
}

export function boundedText(value: string, label: string, maximum: number): string {
    if (value.trim() === '' || Buffer.byteLength(value, 'utf8') > maximum) {
        throw githubRepositoryError(`The ${label} is empty or too large.`);
    }
    return value;
}

export function positiveNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw githubRepositoryError(`GitHub returned an invalid ${label}.`);
    }
    return value;
}

export function requireStatus(
    actual: number,
    expected: readonly number[],
    operation: string,
): void {
    if (!expected.includes(actual)) {
        throw githubRepositoryError(
            `GitHub could not ${operation}; the API returned HTTP ${actual.toString()}.`,
        );
    }
}

export function githubRepositoryError(message: string): ReturnType<typeof actionError> {
    return actionError('ZOLT-GITHUB-API-002', message);
}

function responseBody(value: unknown): string {
    if (value === null) return '';
    const body = stringField(value, 'pull request body');
    if (Buffer.byteLength(body, 'utf8') > MAX_PULL_REQUEST_BODY_BYTES) {
        throw githubRepositoryError('GitHub returned an excessive pull request body.');
    }
    return body;
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw githubRepositoryError(`GitHub returned an invalid ${label}.`);
    }
    return value as Record<string, unknown>;
}

function stringField(value: unknown, label: string): string {
    if (typeof value !== 'string' || value === '') {
        throw githubRepositoryError(`GitHub returned an invalid ${label}.`);
    }
    return value;
}

import * as assert from 'node:assert/strict';
import test from 'node:test';

import { GitHubActionCore } from '../src/action/core.js';
import { readInputs } from '../src/inputs.js';
import { FakeActionCore } from './support/core.js';

test('readInputs accepts the documented defaults and masks the GitHub token', () => {
    const core = new FakeActionCore({ 'github-token': 'token-1234' });
    const masked: string[] = [];
    const inputs = readInputs(core, (value) => masked.push(value));

    assert.deepEqual(inputs, {
        directory: '.',
        dryRun: true,
        githubToken: 'token-1234',
        includePrereleases: false,
        openPullRequestsLimit: 5,
        registryEnv: [],
        selectors: [],
        updateCeiling: 'minor',
        workspace: 'auto',
    });
    assert.deepEqual(masked, ['token-1234']);
});

test('readInputs normalizes lists and rejects traversal and GitHub credential channels', () => {
    const core = new FakeActionCore({
        directory: 'apps/api',
        'github-token': 'token-1234',
        'registry-env': 'MAVEN_USER\nMAVEN_PASSWORD\nMAVEN_USER',
        selectors: 'guava\n[versions]\nguava',
        workspace: 'true',
    });
    const inputs = readInputs(core, () => undefined);
    assert.deepEqual(inputs.registryEnv, ['MAVEN_USER', 'MAVEN_PASSWORD']);
    assert.deepEqual(inputs.selectors, ['guava', '[versions]']);
    assert.equal(inputs.directory, 'apps/api');
    assert.equal(inputs.workspace, 'true');

    assert.throws(
        () => readInputs(new FakeActionCore({ directory: '../escape', 'github-token': 'token-1234' }), () => undefined),
        /directory cannot contain parent traversal/u,
    );
    assert.throws(
        () => readInputs(new FakeActionCore({ 'github-token': 'token-1234', 'registry-env': 'GITHUB_TOKEN' }), () => undefined),
        /cannot expose GitHub credential channel/u,
    );
});

test('GitHubActionCore reads hyphenated action input environment names', () => {
    const core = new GitHubActionCore({ 'INPUT_OPEN-PULL-REQUESTS-LIMIT': ' 7 ' });
    assert.equal(core.getInput('open-pull-requests-limit'), '7');
});

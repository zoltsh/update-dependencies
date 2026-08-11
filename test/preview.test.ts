import * as assert from 'node:assert/strict';
import test from 'node:test';

import { compactPreview, renderPullRequestPreview } from '../src/github/preview.js';
import { planUpdates } from '../src/planner/plan.js';
import {
    actionInputs,
    outdatedReport,
    outdatedReportV2,
    projectSelection,
    TEST_TARGET_ID,
} from './support/fixtures.js';

test('schema-v1 pull request previews remain explicit provisional plans', () => {
    const target = planUpdates(outdatedReport(), projectSelection(), actionInputs()).selected[0];
    assert.ok(target);
    const first = renderPullRequestPreview(target);
    const second = renderPullRequestPreview(target);

    assert.deepEqual(first, second);
    assert.match(first.branch, /^zolt\/update\/demo-[0-9a-f]{10}-0{10}$/u);
    assert.match(first.marker, /^<!-- zolt-update-dependencies:preview-v2:/u);
    assert.match(first.body, /schema v1/u);
    assert.equal(compactPreview(target, first).targetId, target.targetId);
    assert.equal(compactPreview(target, first).authoritativeTarget, false);
});

test('managed branches use a collision-safe publication generation', () => {
    const target = planUpdates(outdatedReportV2(), projectSelection(), actionInputs()).selected[0];
    assert.ok(target);
    const first = renderPullRequestPreview(target, 'a'.repeat(40));
    const second = renderPullRequestPreview(target, 'b'.repeat(40));

    assert.notEqual(first.branch, second.branch);
    assert.match(first.branch, /-aaaaaaaaaa$/u);
    assert.match(second.branch, /-bbbbbbbbbb$/u);
});

test('schema-v2 pull request previews use Zolt target and repository managed identity', () => {
    const target = planUpdates(outdatedReportV2(), projectSelection(), actionInputs()).selected[0];
    assert.ok(target);
    const preview = renderPullRequestPreview(target);

    assert.match(preview.body, new RegExp(TEST_TARGET_ID, 'u'));
    assert.match(preview.body, /Managed identity/u);
    assert.equal(compactPreview(target, preview).authoritativeTarget, true);
    assert.match(compactPreview(target, preview).managedId, /^zud1_/u);
});

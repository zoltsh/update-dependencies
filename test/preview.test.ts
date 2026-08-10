import * as assert from 'node:assert/strict';
import test from 'node:test';

import { compactPreview, renderPullRequestPreview } from '../src/github/preview.js';
import { planUpdates } from '../src/planner/plan.js';
import { actionInputs, outdatedReport, projectSelection } from './support/fixtures.js';

test('pull request previews have stable managed branch and ownership metadata', () => {
    const target = planUpdates(outdatedReport(), projectSelection(), actionInputs()).selected[0];
    assert.ok(target);
    const first = renderPullRequestPreview(target);
    const second = renderPullRequestPreview(target);

    assert.deepEqual(first, second);
    assert.match(first.branch, /^zolt\/update\/demo-[0-9a-f]{10}$/u);
    assert.match(first.marker, /^<!-- zolt-update-dependencies:preview-v1:/u);
    assert.match(first.body, /deterministic planning preview/u);
    assert.equal(compactPreview(target, first).provisionalTargetId, target.provisionalTargetId);
});

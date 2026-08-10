import * as assert from 'node:assert/strict';
import test from 'node:test';

import { planUpdates } from '../src/planner/plan.js';
import { actionInputs, outdatedEntry, outdatedReport, outdatedScope, projectSelection } from './support/fixtures.js';

test('planUpdates orders patch before minor, applies the PR limit, and classifies blocked surfaces', () => {
    const report = outdatedReport([outdatedScope('demo', [
        outdatedEntry({
            candidates: { major: '2.0.0', minor: '1.0.2', patch: '1.0.2' },
            identifier: 'com.example:patch',
            selectedInMajor: '1.0.2',
            selectedInMajorClass: 'patch',
        }),
        outdatedEntry({ identifier: 'com.example:minor' }),
        outdatedEntry({
            candidates: { major: '2.0.0', minor: null, patch: null },
            identifier: 'com.example:major-only',
            selectedInMajor: null,
            selectedInMajorClass: null,
        }),
        outdatedEntry({ identifier: 'tool', surface: 'openapiTool' }),
        outdatedEntry({ identifier: 'unknown', status: 'unknown' }),
    ])]);

    const plan = planUpdates(report, projectSelection(), actionInputs({ openPullRequestsLimit: 1 }));
    assert.equal(plan.selected[0]?.identifier, 'com.example:patch');
    assert.equal(plan.deferred[0]?.identifier, 'com.example:minor');
    assert.equal(plan.blocked.length, 2);
    assert.equal(plan.outsidePolicy[0]?.identifier, 'com.example:major-only');
    assert.match(plan.selected[0]?.provisionalTargetId ?? '', /^pzt1_/u);
});

test('planUpdates maps workspace scope labels to member manifests and keeps alias fan-out together', () => {
    const report = outdatedReport([outdatedScope('apps/api', [outdatedEntry({
        governs: ['[dependencies].com.example:a', '[test.dependencies].com.example:b'],
        identifier: 'shared',
        members: ['apps/api', 'apps/web'],
        section: '[versions]',
        surface: 'versionAlias',
    })])]);
    const selection = projectSelection({
        manifestPath: 'platform/zolt.toml',
        mode: 'workspace',
        relativeRoot: 'platform',
        root: '/private/repository/platform',
    });

    const plan = planUpdates(report, selection, actionInputs());
    assert.equal(plan.selected[0]?.manifestPath, 'platform/apps/api/zolt.toml');
    assert.deepEqual(plan.selected[0]?.fanOut, [
        '[dependencies].com.example:a',
        '[test.dependencies].com.example:b',
    ]);
});

test('planUpdates rejects unsafe workspace scope labels', () => {
    assert.throws(
        () => planUpdates(
            outdatedReport([outdatedScope('../escape')]),
            projectSelection({ mode: 'workspace' }),
            actionInputs(),
        ),
        /not a safe member path/u,
    );
});

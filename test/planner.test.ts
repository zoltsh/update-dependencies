import * as assert from 'node:assert/strict';
import test from 'node:test';

import { planUpdates } from '../src/planner/plan.js';
import {
    actionInputs,
    outdatedEntry,
    outdatedEntryV2,
    outdatedReport,
    outdatedReportV2,
    outdatedScope,
    outdatedScopeV2,
    projectSelection,
    testTargetId,
    targetIdFor,
} from './support/fixtures.js';

test('planUpdates preserves schema-v1 preview planning and classifies blocked surfaces', () => {
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
    assert.match(plan.selected[0]?.targetId ?? '', /^pzt1_/u);
    assert.match(plan.selected[0]?.managedId ?? '', /^pzud1_/u);
    assert.equal(plan.selected[0]?.authoritativeTarget, false);
});

test('planUpdates maps schema-v1 workspace labels and keeps alias fan-out together', () => {
    const report = outdatedReport([outdatedScope('apps/api', [outdatedEntry({
        governs: ['[dependencies].com.example:a', '[test.dependencies].com.example:b'],
        identifier: 'shared',
        members: ['apps/api', 'apps/web'],
        section: '[versions]',
        surface: 'versionAlias',
    })])]);
    const selection = projectSelection({
        lockfilePath: 'platform/zolt.lock',
        manifestPath: 'platform/zolt.toml',
        mode: 'workspace',
        relativeRoot: 'platform',
        root: '/private/repository/platform',
    });

    const plan = planUpdates(report, selection, actionInputs());
    assert.equal(plan.selected[0]?.manifestPath, 'platform/apps/api/zolt.toml');
    assert.equal(plan.selected[0]?.zoltManifestPath, 'apps/api/zolt.toml');
    assert.deepEqual(plan.selected[0]?.fanOut, [
        '[dependencies].com.example:a',
        '[test.dependencies].com.example:b',
    ]);
});

test('planUpdates consumes authoritative schema-v2 paths, IDs, and applicability', () => {
    const blockedTarget = testTargetId(2);
    const report = outdatedReportV2([outdatedScopeV2('apps/api', [
        outdatedEntryV2({ members: ['apps/api'] }, 'apps/api/zolt.toml'),
        outdatedEntryV2({
            identifier: 'org.example:generator',
            surface: 'openapiTool',
            targetId: blockedTarget,
            updateable: false,
            updateBlocker: 'Route the generated tool through a [versions] alias.',
        }),
    ], { manifestPath: 'apps/api/zolt.toml' })]);
    const selection = projectSelection({
        lockfilePath: 'platform/zolt.lock',
        manifestPath: 'platform/zolt.toml',
        mode: 'workspace',
        relativeRoot: 'platform',
        root: '/private/repository/platform',
    });

    const plan = planUpdates(report, selection, actionInputs());
    assert.equal(plan.selected[0]?.targetId, targetIdFor({ manifestPath: 'apps/api/zolt.toml' }));
    assert.equal(plan.selected[0]?.managedId.startsWith('zud1_'), true);
    assert.equal(plan.selected[0]?.authoritativeTarget, true);
    assert.equal(plan.selected[0]?.manifestPath, 'platform/apps/api/zolt.toml');
    assert.equal(plan.selected[0]?.lockfilePath, 'platform/zolt.lock');
    assert.equal(plan.blocked[0]?.targetId, blockedTarget);
    assert.match(plan.blocked[0]?.reason ?? '', /versions/u);
});

test('planUpdates rejects unsafe schema-v1 labels and inconsistent v2 root locks', () => {
    assert.throws(
        () => planUpdates(
            outdatedReport([outdatedScope('../escape')]),
            projectSelection({ mode: 'workspace' }),
            actionInputs(),
        ),
        /not a safe member path/u,
    );
    assert.throws(
        () => planUpdates(
            outdatedReportV2([outdatedScopeV2('demo', undefined, { lockfilePath: 'other.lock' })]),
            projectSelection(),
            actionInputs(),
        ),
        /mutation root zolt\.lock/u,
    );
    assert.throws(
        () => planUpdates(
            outdatedReportV2([outdatedScopeV2('demo', undefined, { manifestPath: 'nested/zolt.toml' })]),
            projectSelection(),
            actionInputs(),
        ),
        /Standalone Zolt reported manifest/u,
    );
});

test('schema-v2 report shape corrects retained-empty workspace discovery for verification', () => {
    const misclassifiedStandalone = projectSelection({ mode: 'workspace' });
    const standalone = planUpdates(
        outdatedReportV2([outdatedScopeV2('standalone')]),
        misclassifiedStandalone,
        actionInputs(),
    );
    assert.equal(standalone.selected[0]?.zoltMode, 'project');

    const rootMember = planUpdates(
        outdatedReportV2([outdatedScopeV2('.')]),
        misclassifiedStandalone,
        actionInputs(),
    );
    assert.equal(rootMember.selected[0]?.zoltMode, 'workspace');
});

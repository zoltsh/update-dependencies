# Canary

The current canary verifies real GitHub event and runner behavior without
opening the publication gate.

## Planning fixtures

Keep small repositories for:

1. A standalone project with patch and minor updates.
2. A modern workspace with updates in two members and one root lock.
3. A legacy `zolt-workspace.toml` workspace.
4. A shared `[versions]` alias with multi-coordinate fan-out.
5. Private basic-auth and bearer-token Maven repositories.
6. Unavailable metadata.
7. A generated-tool literal that is reportable but not writable.

Pin checkout and this Action to reviewed full commit SHAs. Run through
`workflow_dispatch` with `dry-run: true`; retain the deterministic `plan` output
for comparison.

Require correct Zolt version/checksum, paths, update ordering, alias fan-out,
deferral, blockers, redaction, and byte-identical repeated plans. Require
`dry-run: false` to fail before branch or pull-request operations.

## Contract-ready executor canary

After a published Zolt release declares schema v2, run the executor before
enabling publication:

- exact standalone dependency;
- nested modern-workspace member plus root lock;
- legacy workspace;
- root member `.`;
- shared alias fan-out;
- private basic and bearer repositories;
- stale/unknown target;
- failed resolution with zero file effects;
- unexpected file and mode-change rejection;
- locked/offline verification with no second mutation.

For each target, compare the prepared artifact against the original commit and
require exactly the expected manifest and root-lock bytes.

## Publication canary

The write gate may open only after a separate canary covers:

1. create one managed PR;
2. identical rerun is a no-op;
3. newer target refreshes the same branch/PR;
4. base branch satisfies the update and closes the obsolete PR;
5. human branch commit blocks refresh;
6. duplicate managed markers block both PRs;
7. PR-limit capacity is calculated after safe closes and existing refreshes;
8. default branch advancement aborts before ref publication;
9. a human commit racing a refresh causes the non-force ref update to fail;
10. partial GitHub API failure reports every already-visible write;
11. private credentials and GitHub tokens remain absent from logs and Zolt's
    process environment.

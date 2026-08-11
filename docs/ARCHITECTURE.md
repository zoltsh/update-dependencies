# Architecture

`update-dependencies` turns dependency-update candidates reported by one
verified Zolt binary into deterministic managed pull-request intent. The public
Action remains planning-only, but the second implementation batch contains the
contract-ready exact-update and reconciliation kernels behind that closed gate.

```text
trusted event + exact GITHUB_SHA
              |
              v
 immutable private repository view
              |
              v
 checksum-pinned Zolt installation
              |
              v
 strict outdated JSON v1 or v2 decode
              |
              v
 policy + limit + managed identity
              |
              v
 PR title, branch, marker, and job summary preview
              |
              v
       publication gate (closed)
```

The pinned Zolt release currently declares outdated schema v1. Separately, CI
builds reviewed Zolt source commit
`ae6532ef804c6347c6b1e72742216b9443c6c288` and exercises the real schema-v2
contract. Moving the production selector to v2 remains coupled to pinning a
matching immutable binary and all four checksums.

## Contract-ready execution path

The repository also implements this dormant path:

```text
authoritative schema-v2 target
              |
              v
fresh extraction of the exact base commit
              |
              v
zolt update --target-id ID --to VERSION --schema-version 2
              |
              v
independent changed-file and byte verification
              |
              v
zolt resolve --locked --offline
              |
              v
immutable update artifact: manifest + root lock bytes
```

Every target receives a new archive extraction. Update copies are never cloned
from another target and never mutate the immutable planning view. The executor
requires the actual filesystem changes and Zolt's `changedFiles` report to
match exactly and to stay inside the selected manifest/root-lock boundary. It
also snapshots artifact bytes and modes before locked verification so a second
rewrite of an already-changed file cannot hide behind an unchanged path list.

## Modules

| Module | Responsibility |
| :--- | :--- |
| `action` | Small GitHub Actions command, output, secret, and summary adapter |
| `environment` | Validate the event, materialize the exact commit, and create independent mutable copies |
| `install` | Download, hash, inspect, extract, and version-check the pinned Zolt archive |
| `zolt` | Discover scope, isolate credentials, execute Zolt, and strictly decode v1/v2 machine contracts |
| `planner` | Select policy-compliant updates and derive repository-scoped managed identities |
| `update` | Execute one exact target in isolation and produce verified changed-file bytes |
| `github` | Render previews, encode markers, reconcile managed PRs, and expose bounded Git-data/PR API operations |
| `main` | Compose the public planning path and guarantee cleanup on success or failure |

## Rules

1. The checkout is only a Git object source. Analysis reads a private copy of
   tracked files at the exact `GITHUB_SHA`.
2. `GITHUB_WORKSPACE` must be the checkout root. Symlinks, submodules,
   unsupported modes, path escapes, case collisions, and configured size limits
   fail before analysis.
3. The Action runs one exact Zolt version with one SHA-256 per supported target.
4. Archives may contain one expected executable and no links, special files,
   traversal paths, privilege bits, duplicate paths, or unexpected executables.
5. Zolt runs by absolute path with argument arrays and no shell.
6. Zolt receives a minimal environment plus explicitly selected Maven
   credentials. It never receives the GitHub pull-request token.
7. Machine output is bounded, valid UTF-8, and decoded with exact fields.
   Unknown schemas and fields fail closed.
8. Schema v1 remains a preview compatibility path. Only schema-v2 `zt1_`
   targets may enter exact execution or managed reconciliation.
9. Version aliases remain one logical target, including complete fan-out.
10. Patch updates sort before minor updates, then major updates; ties are
    deterministic.
11. Every authoritative target names one canonical manifest and one canonical
    root lockfile under the selected Zolt root.
12. Each exact update starts from a fresh extraction of the same base commit.
13. Actual changed files must equal Zolt-reported changed files and be a subset
    of the selected manifest and root lock. File deletion, mode changes,
    symlinks, unexpected files, non-empty residue, and publishable files above
    16 MiB fail the target.
14. Locked/offline verification must not change either the observed path set or
    the prepared artifact bytes.
15. Managed PR reconciliation refreshes existing safe PRs before creating new
    ones. Obsolete unmodified PRs close; duplicate ownership and human changes
    block rather than overwrite.
16. GitHub writes use bounded JSON responses, base-tree Git objects, and only
    non-force generated-branch ref updates. Refresh commits retain the previous
    managed head as a parent so a racing human change cannot be overwritten.
17. `dry-run: false` still fails before repository mutation or GitHub API calls
    in the public Action.
18. Public diagnostics are bounded, control-stripped, and redacted.
19. Temporary installations, credential homes, repository views, and mutable
    copies clean up independently; cleanup failure fails the Action.

## Planning and identity model

A planned target includes:

- current and exact destination versions;
- patch, minor, or major classification;
- dependency surface and section;
- repository-relative manifest and root-lock paths;
- mutation-root-relative Zolt paths;
- alias fan-out and workspace attribution;
- source repository and diagnostics;
- a Zolt target ID and repository-scoped managed identity.

Schema v1 uses explicit provisional `pzt1_`/`pzud1_` identities. Schema v2 uses
Zolt's `zt1_` target and derives a stable `zud1_` identity from the selected
Zolt root plus that target. The destination version is never part of either
managed identity, allowing a PR to refresh in place.

## Managed reconciliation

The pure reconciliation state machine accepts desired authoritative targets and
open pull-request metadata. A final managed marker records:

- schema version;
- repository-scoped managed ID;
- Zolt target ID and root;
- manifest and root-lock paths;
- exact destination version;
- base commit and destination version last published;
- the exact branch head last written by the Action.

A branch is refreshable only when its current head still equals the marker's
managed head, its branch name matches the desired target, and every identity
and path field still agrees. A matching base SHA and destination is classified
as unchanged, making identical reruns a no-op. Invalid markers on plausible
local managed branches, duplicate managed IDs, identity collisions, and
human-modified heads are blocked. Marker copies from forks or unrelated base
branches are ignored rather than allowed to consume managed-PR capacity.
Blocked local managed PRs count against the concurrent open-PR limit so the
Action never creates a duplicate to work around an unsafe existing branch.

## Dormant publication orchestration

The GitHub API primitives and their orchestrator are implemented but dormant.
The orchestrator composes reconciliation and exact artifacts in this order:

```text
open PR inventory + reconciliation
      |
      v
recheck default branch + every managed branch head
      |
      v
prepare and verify every exact update artifact
      |
      v
close obsolete PRs -> refresh owned PRs -> create new PRs
```

Every artifact is ready before the first visible write. Immediately before each
close, ref create/update, or PR create/update, the orchestrator rechecks the
default-branch SHA and relevant managed branch head. Refreshes retain the prior
managed head as a commit parent and use only a non-force ref update. If a later
API operation fails, the raised failure carries an ordered snapshot of every
completed branch or pull-request write so recovery does not depend on guessing.

The client does not use checkout credentials or `git push`; it accepts only
GitHub.com, bounds responses, validates response identities, and never offers a
force-update option. Maven credentials and GitHub write credentials remain in
separate adapters. The publication gate can open only after a real pinned Zolt
v2 release and live create/refresh/no-op/close/private-registry canaries pass,
then `runAction` explicitly composes this dormant module.

## Source-contract boundary

Schema-v2 target IDs are verified cryptographically from their canonical
identity fields; a syntactically valid but mismatched `zt1_` value is rejected.
JSON-mode nonzero exits retain stdout/stderr in a private process error, then the
command adapter strictly decodes the selected-schema failure envelope. The
planner also derives locked-verification mode from authoritative v2 scope shape,
correcting an Action-side lexical workspace misclassification for Zolt's
retained empty workspace domain.

## Compatibility

Each Action release owns its embedded Zolt version and declared machine schema.
Changing the schema selector is an explicit release-metadata and fixture change.
Schema-v1 preview identities are not compatibility promises. The schema-v2
contract, `zud1_` derivation, managed marker v1, reconciliation safety rules,
and changed-file policy become public release contracts only when write mode is
published.

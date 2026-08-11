# Security

## Report a vulnerability

Use GitHub private vulnerability reporting for `zoltsh/update-dependencies`.
Do not open a public issue.

Include the Action ref, runner target, workflow inputs, and a minimal
reproduction. Do not include credentials, private repository URLs, or private
artifact metadata.

## Versions

Security fixes are applied to the latest release. Pin the Action to a full
reviewed commit SHA and update that pin after a fix is released.

## Model

The Action treats event data, Git trees, repository paths, Zolt archives,
machine output, registry diagnostics, mutable update copies, managed markers,
and eventual GitHub API responses as untrusted.

- The Action runs only for `schedule`, `workflow_dispatch`, or default-branch
  `push` events on GitHub.com.
- Repository identity, default branch, ref, and full commit SHA are validated.
- Tracked blobs from the exact commit are copied to a private immutable view.
  Dirty or untracked checkout content cannot influence analysis.
- Repository views reject symlinks, submodules, unsupported modes, unsafe paths,
  case collisions, oversized blobs, and oversized repositories.
- Zolt release URLs and targets are fixed in source. Downloads must match their
  target SHA-256 and expected archive root.
- Archive handling bounds compressed/extracted size, entry count, per-entry
  size, and decompression ratio. Links, special files, traversal, duplicates,
  privilege bits, and unexpected executables are rejected.
- The verified Zolt executable runs by absolute path, without a shell, with
  bounded UTF-8 output and a timeout.
- Outdated and exact-update JSON are decoded with exact fields. Unknown schemas,
  statuses, surfaces, target IDs, paths, candidate classes, or inconsistent
  effect fields fail closed.
- Zolt receives only proxy, certificate, locale, path, temporary-directory
  settings, and variables explicitly named by `registry-env`.
- GitHub credential channels cannot be selected for `registry-env`; a selected
  value containing the GitHub token is rejected.
- Every selected credential is registered for runner masking and diagnostic
  redaction regardless of its name.
- Public output strips terminal escapes and controls, redacts raw, URL-encoded,
  and base64 secret forms, and is size-bounded.

## Exact-update kernel

The contract-ready executor is not invoked by the public planning entrypoint
until a v2 Zolt release is pinned. Its boundary is nevertheless enforced and
process-tested:

- each target receives a fresh extraction of the original exact-commit archive;
- update copies never share mutations and never alter the immutable view;
- only authoritative schema-v2 targets are executable;
- result identity and requested versions must match discovery exactly;
- actual changed files must equal Zolt's report and stay within the selected
  manifest/root-lock boundary;
- each publishable manifest or lock artifact is capped at 16 MiB, below the
  larger immutable-repository inspection limit;
- deletions, executable-bit changes, symlinks, extra files, and
  non-empty transaction residue fail closed;
- artifact bytes and modes are captured before and after locked/offline
  verification so a rewrite of an already-changed file is detected;
- the immutable planning view is verified again after artifact preparation.

## Managed pull requests

Final managed markers are strict, bounded, versioned, canonical base64url JSON.
They bind a repository-scoped managed ID, Zolt target/path identity, and exact
destination to the base commit and exact branch head last written by the
Action. The managed ID is recomputed from the Zolt root and target ID while
decoding, so those fields cannot disagree.

Reconciliation never refreshes a PR when its branch head has changed, its branch
name differs, its marker no longer matches the desired target, or more than one
open PR claims the same managed identity. Those cases are blocked rather than
force-overwritten. Matching base/destination markers are unchanged. Marker
claims from forks or unrelated base branches are ignored, so an untrusted PR
cannot consume managed-PR capacity merely by copying an Action marker. Blocked
local managed PRs count against the open-PR limit, avoiding an unsafe duplicate
replacement.

## Current publication boundary

The public Action performs no checkout, branch, pull-request, or manifest
writes. `dry-run: false` fails before those operations. A dormant, bounded
GitHub.com client now implements blob, tree, commit, ref, and pull-request API
operations without checkout credentials or `git push`. It exposes only
`force: false` ref updates. A refresh commit retains the previous managed head
as a parent, so a concurrent human branch commit makes the ref update fail
rather than disappear.

The remaining publication orchestrator must recheck the default branch, apply
reconciliation, publish each verified artifact, report partial visibility, and
keep the GitHub token out of Zolt and Maven credentials out of GitHub calls.

The Action cannot protect a compromised runner, workflow, selected Action
commit, embedded Zolt release, Git client, system `tar`, or repository
administrator token.

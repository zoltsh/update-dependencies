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
machine output, registry diagnostics, and eventual GitHub API responses as
untrusted.

- The Action runs only for `schedule`, `workflow_dispatch`, or default-branch
  `push` events on GitHub.com.
- Repository identity, default branch, ref, and full commit SHA are validated.
- Tracked blobs from the exact commit are copied to a private view. Dirty or
  untracked checkout content cannot influence Zolt analysis.
- The repository view rejects symlinks, submodules, unsupported modes, unsafe
  paths, case-colliding paths, oversized blobs, and oversized repositories.
- Zolt release URLs and targets are fixed in source. Downloads must match their
  target SHA-256 and expected archive root.
- The archive reader bounds compressed and extracted sizes, entry count,
  per-entry size, and decompression ratio. It rejects links, special files,
  traversal, duplicates, privilege bits, and unexpected executables.
- The verified Zolt executable runs by absolute path, without a shell, with
  bounded UTF-8 output and a timeout.
- `outdated` JSON is decoded with exact fields. Unknown schemas, statuses,
  surfaces, candidate classes, or malformed pairings fail closed.
- Zolt receives only proxy, certificate, locale, path, temporary-directory
  settings, and variables explicitly named by `registry-env`.
- GitHub credential channels cannot be selected for `registry-env`. A selected
  value containing the GitHub token is rejected.
- Every selected credential is registered for runner masking and diagnostic
  redaction regardless of its variable name.
- Public output strips terminal escapes and control characters, redacts raw,
  URL-encoded, and base64 secret forms, and is size-bounded.
- This implementation batch performs no repository, branch, pull-request, or
  manifest writes. `dry-run: false` fails before those operations.

The Action cannot protect a compromised runner, workflow, selected Action
commit, embedded Zolt release, Git client, system `tar`, or repository
administrator token.

## Future write boundary

Write mode must not ship until all of the following are enforced:

1. Zolt accepts one authoritative target ID and one exact destination version.
2. Each update executes in a fresh private copy of the current base commit.
3. Zolt reports the exact manifest and root lock it changed.
4. The Action independently allows only those two paths.
5. `zolt resolve --locked --offline` succeeds after mutation.
6. GitHub writes use blob, tree, commit, ref, and pull-request APIs; the token is
   never placed in checkout credentials or passed to Zolt.
7. Existing managed branches are updated only when their marker, head
   repository, branch, history, and diff all remain Action-owned.
8. Human-modified managed branches are reported as blocked and never
   force-pushed.

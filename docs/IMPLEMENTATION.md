# Implementation status

The Action implements the complete managed update path:

- reconstruct and validate the exact triggering commit;
- download and verify one immutable Zolt schema-v2 release;
- discover standalone, modern-workspace, and legacy-workspace targets;
- apply policy, selectors, prerelease handling, and the concurrent PR limit;
- prepare every exact update in an independent repository copy;
- accept only the expected manifest and root-lock changes;
- complete locked offline verification before any GitHub write;
- reconcile owned pull requests as create, refresh, unchanged, safe close,
  deferred, or blocked;
- publish Git objects and non-force branch updates through the GitHub API; and
- report deterministic outputs plus every already-visible write if a later
  operation fails.

`dry-run: true` is the default and stops after planning. `dry-run: false`
requires authoritative schema-v2 targets and enables managed publication.
Human-modified branches, duplicate ownership markers, unexpected files,
default-branch races, and non-fast-forward ref updates fail closed.

Source-built and released Zolt binaries share the same contract suite. The
released-binary executor matrix covers standalone projects, modern and legacy
workspaces, root members, alias fan-out, and allowlisted basic and bearer
credentials. Reconciliation and API tests cover idempotency, refresh, close,
ownership conflicts, races, and partial failures.

## Later

- Release dates and cooldown policy.
- Security-advisory-selected exact versions.
- Grouped multi-target pull requests.
- GitHub App installation-token mode.
- Native `dependabot-core` ecosystem support.

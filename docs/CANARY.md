# Canaries

CI validates both sides of the Action's trust boundary.

## Zolt contract

The source-contract job builds reviewed Zolt commit
`486974e1a11b39d2bea5cb0a3621befa4ebfd160`. The runtime matrix downloads every
pinned platform archive and verifies its checksum, version, and schema-v2
behavior.

Both paths exercise production capture and the exact-update executor across:

- standalone projects;
- modern, legacy, and root-member workspaces;
- workspace-root platform policy and aggregate lock regeneration;
- shared version aliases;
- locked offline verification; and
- allowlisted basic and bearer repository credentials.

The canaries require exactly the expected manifest and root-lock bytes and prove
that the GitHub token is absent from Zolt's environment.

## Publication

The manual `publication-canary` workflow runs the committed Action against a
fixture in this repository. It creates one managed PR, repeats the run to prove
idempotency, then closes the PR. Its cleanup step fails if the Action leaves the
canary PR open.

Deterministic reconciliation and GitHub adapter tests cover refresh, obsolete
close, human-modified heads, duplicate markers, PR-limit reuse, default-branch
advancement, non-fast-forward races, and partial API failures without relying
on timing-sensitive live mutations.

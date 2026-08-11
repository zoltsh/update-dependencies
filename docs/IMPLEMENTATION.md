# Implementation status

## Public Action path

The public entrypoint currently implements the safe planning half of
`zoltsh/update-dependencies`:

- Node 24 Action metadata and a zero-runtime-dependency TypeScript codebase.
- Default-branch event enforcement.
- Exact-commit, dirty-checkout-independent repository reconstruction.
- Repository path, mode, size, case-collision, and post-analysis Git-blob validation.
- Four-target checksum-pinned Zolt release metadata.
- Bounded gzip/tar inspection and extraction.
- Exact Zolt version verification.
- Modern, legacy, and standalone project selection.
- Private Maven credential allowlisting and GitHub-token isolation.
- Strict stable `zolt outdated --format json` schema-v1 decoding.
- Source-pinned schema-v2 and exact-target canaries against reviewed Zolt main.
- Patch, minor, and major policy selection.
- Workspace member manifest mapping, alias fan-out, and member attribution.
- Stable provisional target, branch, title, marker, and body generation.
- Selected, deferred, blocked, and out-of-policy summaries.
- Explicit write-mode refusal.
- Built-in Node test suite and reproducible committed `dist/`.

The pinned release declares schema v1. `ZOLT_OUTDATED_SCHEMA_VERSION` is kept
beside its generated release metadata, so a release upgrade cannot silently
switch machine contracts.

## Contract-ready execution batch

The repository now contains the next write-path layer, still unreachable from
`runAction`:

- A strict outdated schema-v2 decoder that recomputes canonical `zt1_` target
  IDs from manifest/surface/section/identifier identity, validates Unicode NFC,
  mutation-root-relative paths, surface mutability, and updateability blockers.
- A strict exact-update schema-v2 decoder covering applied, dry-run, no-resolve,
  and same-version no-op effects, plus selected-schema failure envelopes.
- Repository-relative path primitives shared by contracts, planning, markers,
  and execution.
- A retained exact-commit archive that can produce a fresh mutable extraction
  for every logical update target.
- Independent change inspection against the original Git tree, including
  additions, deletions, byte changes, executable changes, privilege bits,
  symlinks, case collisions, and unexpected directories.
- An exact-update executor that validates target identity, destination,
  fan-out, result paths, observed changes, locked/offline verification, and
  immutable-view integrity before returning manifest/lock bytes.
- A reviewed-source canary pinned to Zolt commit
  `ae6532ef804c6347c6b1e72742216b9443c6c288`, covering standalone, workspace,
  retained-empty workspace, exact mutation, target vectors, and JSON failures.
- Process-boundary tests using a real fake executable for standalone and
  workspace updates, unexpected writes, false reports, mode changes,
  verification rewrites, and provisional-target rejection.
- A strict final managed marker binding managed ID, target/path identity, exact
  destination, base commit, and last Action-written branch head.
- A pure managed-PR reconciliation state machine that plans unchanged PRs, safe
  refreshes, obsolete closes, new creates, deferrals, and blockers while
  refusing human changes, copied local markers, duplicate ownership claims, or
  mismatched branches. Fork and unrelated-base marker copies are ignored.
- A zero-dependency GitHub.com API client for open-PR inventory, blobs, trees,
  commits, generated refs, and PR create/update/close operations. Refresh
  commits retain the old managed head as a parent and refs update only with
  `force: false`, making concurrent human writes fail safely.

## Remaining publication work

The write gate opens only after all of the following land together:

1. An immutable Zolt release containing the reviewed schema-v2 contract (or a
   reviewed descendant) is published.
2. The Action pins that build and its four checksums and flips the generated
   schema selector to `2`.
3. Live standalone, workspace, alias, and private-registry canaries pass against
   the real binary.
4. The publication orchestrator composes the existing GitHub adapter with
   exact artifacts and reconciliation, including a final default-branch check.
5. Default-branch advancement, partial API failure, idempotent rerun, refresh,
   close, and human-modification canaries pass.
6. `runAction` composes executor, reconciliation, and publication and removes
   `ZOLT-WRITE-001`.

## Later

- Release dates and cooldown policy.
- Security-advisory-selected exact versions.
- Grouped multi-target pull requests.
- GitHub App installation-token mode.
- Native `dependabot-core` ecosystem support.

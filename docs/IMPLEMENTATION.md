# Implementation status

## First batch

The repository currently implements the safe planning half of
`zoltsh/update-dependencies`:

- Node 24 Action metadata and zero-runtime-dependency TypeScript codebase.
- Default-branch event enforcement.
- Exact-commit, dirty-checkout-independent repository reconstruction.
- Repository path, mode, size, and case-collision validation.
- Four-target checksum-pinned Zolt release metadata.
- Bounded gzip/tar inspection and extraction without a runtime archive package.
- Exact Zolt version verification.
- Modern, legacy, and standalone project selection.
- Private Maven credential allowlisting and GitHub-token isolation.
- Strict `zolt outdated --format json` schema-v1 decoder.
- Patch, minor, and major policy selection.
- Workspace member manifest mapping.
- Alias fan-out and member attribution.
- Stable provisional target, branch, title, marker, and body generation.
- Selected, deferred, blocked, and out-of-policy summaries.
- Explicit write-mode refusal.
- Built-in Node test suite and reproducible committed `dist/`.

## Required Zolt contract

Write mode depends on an authoritative machine target. The desired interface is:

```console
zolt outdated --workspace --format json --schema-version 2
zolt update --target-id TARGET --to VERSION --format json --schema-version 2
```

Every discoverable update surface should report:

```json
{
  "targetId": "zt1_opaque-stable-value",
  "manifestPath": "apps/api/zolt.toml",
  "lockfilePath": "zolt.lock",
  "workspaceRoot": ".",
  "surface": "dependency",
  "section": "[dependencies]",
  "identifier": "com.google.guava:guava",
  "current": "33.3.1-jre",
  "updateable": true
}
```

The exact update result should include `from`, `to`, `class`, `changed`,
`resolved`, `fanOut`, and the canonical `changedFiles` array. Zolt must route the
target to the correct member manifest and use its existing workspace mutation
lock and manifest/root-lock transaction.

## Next Action batch

Once that Zolt release exists:

1. Accept JSON schema v2 and canonical `zt1_` IDs.
2. Apply each selected target to a fresh copy of the same default-branch base.
3. Require successful resolution and a changed-file set containing only the
   target manifest and canonical root lock.
4. Run locked/offline verification after mutation.
5. Build Git blobs, trees, and commits through the GitHub API.
6. Create one stable managed branch and pull request per target.
7. Reconcile existing Action-owned PRs without overwriting human changes.
8. Close obsolete managed PRs and fill remaining PR capacity deterministically.
9. Add private-registry and live GitHub canaries.

## Later

- Release dates and cooldown policy.
- Security-advisory-selected exact versions.
- Grouped multi-target pull requests.
- GitHub App installation-token mode.
- Native `dependabot-core` ecosystem support.

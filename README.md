<p align="center">
  <img src="https://raw.githubusercontent.com/zoltsh/zolt/main/logo.svg" alt="zolt" width="720">
</p>

<h3 align="center">Open pull requests for Zolt dependency updates</h3>

<p align="center">
  Deterministic update planning from <code>zolt outdated</code>, with workspace,
  private-repository, and lockfile boundaries designed for safe automation.
</p>

<p align="center">
  <a href="#use">Use</a>
  <span> · </span>
  <a href="#what-it-does">What it does</a>
  <span> · </span>
  <a href="#inputs">Inputs</a>
  <span> · </span>
  <a href="#workspaces">Workspaces</a>
  <span> · </span>
  <a href="./SECURITY.md">Security</a>
  <span> · </span>
  <a href="#development">Development</a>
</p>

<br />

> [!IMPORTANT]
> The public Action is still **planning-only**. Zolt's schema-v2 exact-target
> contract is implemented on `zoltsh/zolt` main and exercised by a source-pinned
> contract canary, but the Action still embeds the older schema-v1 release. GitHub
> publication remains disabled until a matching immutable release and checksums
> are pinned. Pin the action to a reviewed full commit SHA.

## Use

Run on a schedule, through `workflow_dispatch`, or on a default-branch push.
The action rejects pull requests, merge queues, non-default branches, and
GitHub Enterprise Server.

```yaml
name: Update Zolt dependencies

on:
  schedule:
    - cron: "17 9 * * 1"
  workflow_dispatch:

concurrency:
  group: zolt-update-dependencies-${{ github.repository }}
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  plan:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@<full-commit-sha>
        with:
          persist-credentials: false

      - uses: zoltsh/update-dependencies@<full-commit-sha>
        with:
          directory: .
          workspace: auto
          update-ceiling: minor
          open-pull-requests-limit: 5
          dry-run: true
```

The job summary lists selected, deferred, blocked, and outside-policy updates.
The `plan` output is deterministic JSON suitable for canaries and contract
checks.

## What it does

The public entrypoint performs the complete read and planning path:

1. Validate the repository, event, default branch, ref, and full commit SHA.
2. Reconstruct tracked blobs from that exact commit in a private immutable view;
   dirty checkout files are ignored.
3. Download one embedded Zolt release, verify SHA-256 and archive structure,
   extract it privately, and verify its exact version.
4. Give Zolt a minimal environment plus only credential variables explicitly
   named by `registry-env`.
5. Decode the machine-readable outdated schema declared beside the pinned Zolt
   release. The current release declares schema v1. Schema v2 is implemented in
   Zolt source and continuously checked at its reviewed commit, but production
   selection waits for matching immutable release metadata and checksums.
6. Apply update policy and deterministic ordering while preserving alias fan-out.
7. Render target identities, branch names, PR previews, outputs, and summaries.
8. Reject publication before any checkout mutation or GitHub branch call.

The contract-ready kernel additionally provides:

- strict schema-v2 target decoding that recomputes every `zt1_` ID from Zolt's
  canonical identity fields;
- repository-scoped `zud1_` managed identities;
- one fresh exact-commit extraction per update target;
- exact-target invocation, selected-schema failure decoding, and strict result validation;
- actual changed-file and artifact-byte verification;
- post-update `resolve --locked --offline` verification;
- strict managed markers with destination, base, and managed-head identity;
- pure unchanged/refresh/create/close/defer/block reconciliation that never
  overwrites a human-modified branch;
- a bounded GitHub.com Git-data and pull-request client that creates blobs,
  trees, merge-safe commits, and non-force managed ref updates.

Those components are process- and adapter-tested but not wired to public write
mode yet.

## Inputs

| Input | Default | Meaning |
| :--- | :---: | :--- |
| `directory` | `.` | Project directory, or a directory inside the target workspace |
| `workspace` | `auto` | `auto`, `true`, or `false` |
| `github-token` | `github.token` | Reserved for managed branch and pull-request operations; never passed to Zolt |
| `update-ceiling` | `minor` | Largest allowed update class: `patch`, `minor`, or `major` |
| `include-prereleases` | `false` | Include prerelease versions in Zolt discovery |
| `selectors` | — | Coordinate, alias, section, or member selectors, one per line |
| `open-pull-requests-limit` | `5` | Maximum eligible targets selected in one run, from `0` through `100` |
| `registry-env` | — | Repository credential environment-variable names passed to Zolt, one per line |
| `dry-run` | `true` | Produce a plan without branches or pull requests; `false` is rejected in this batch |

## Outputs

| Output | Meaning |
| :--- | :--- |
| `planned-update-count` | Targets selected after policy and limit application |
| `deferred-update-count` | Eligible targets deferred by the limit |
| `blocked-update-count` | Unknown or currently non-writable targets |
| `plan` | Deterministic JSON array of selected update previews |
| `created-pull-request-count` | Always `0` in the planning batch |
| `updated-pull-request-count` | Always `0` in the planning batch |
| `closed-pull-request-count` | Always `0` in the planning batch |
| `zolt-version` | Exact verified Zolt version used |

## Workspaces

`workspace: auto` searches upward from `directory` for either:

- `[workspace]` in `zolt.toml`; or
- the legacy `zolt-workspace.toml` file.

Declaring both at one root is rejected. A workspace must have one root
`zolt.lock`. Zolt reports one scope per member; the planner maps each scope to
its member `zolt.toml` while retaining the single root lockfile as the future
changed-file boundary.

`workspace: false` treats the selected directory as a standalone project and
requires both `zolt.toml` and `zolt.lock` there. `workspace: true` fails if no
workspace is found.

## Private Maven repositories

Zolt repository credentials remain environment-name references in
`zolt.toml`. The action receives values through explicit workflow environment
variables and an allowlist:

```yaml
- uses: zoltsh/update-dependencies@<full-commit-sha>
  env:
    MAVEN_USERNAME: ${{ secrets.MAVEN_USERNAME }}
    MAVEN_PASSWORD: ${{ secrets.MAVEN_PASSWORD }}
  with:
    registry-env: |
      MAVEN_USERNAME
      MAVEN_PASSWORD
```

Every selected value is masked and redacted. GitHub token channels are rejected,
and a selected registry value containing the GitHub token is rejected. Unlisted
environment variables do not reach Zolt.

## Planning identities

Schema-v1 `pzt1_…` target and `pzud1_…` managed identities are explicitly
provisional. A schema-v2 release supplies the authoritative `zt1_…` target; the
Action derives `zud1_…` from the selected Zolt root plus that ID. Destination
versions are deliberately excluded so a managed PR can refresh in place.

See [Zolt automation contract](./docs/ZOLT_CONTRACT.md).

## Runners

Supported targets are `linux-x64`, `linux-arm64`, `macos-x64`, and
`macos-arm64`. Windows is rejected before Zolt installation.

The action supports GitHub.com only. GitHub Enterprise Server is not currently
supported.

## Read more

| Read | When you need it |
| :--- | :--- |
| [Architecture](./docs/ARCHITECTURE.md) | Understand modules, boundaries, and the write-path gate |
| [Security](./SECURITY.md) | Review trust assumptions, credentials, and failure behavior |
| [Zolt contract](./docs/ZOLT_CONTRACT.md) | Review the implemented exact-target contract and release gate |
| [Canary guide](./docs/CANARY.md) | Exercise planning against standalone and workspace fixtures |
| [Release guide](./docs/RELEASING.md) | Publish a reviewed JavaScript Action release |

## Development

Use Node 24 or newer.

```sh
npm ci
scripts/check
```

`check` verifies types, repository style and security rules, all tests, the
committed runtime tree, and Action metadata. The suite includes fake-Zolt
process-boundary tests for exact standalone/workspace updates and pure managed
PR reconciliation tests. CI additionally builds the reviewed `zoltsh/zolt`
source commit and runs standalone, workspace, retained-empty, and failure-envelope
contract canaries, plus `actionlint`, `npm audit`, dependency review, and the
supported runner matrix.

The committed `dist/` directory is the Action runtime. This batch has no runtime
npm dependencies: TypeScript compiles the source into an ESM module tree that
runs under GitHub Actions Node 24.

## License

MIT. See [LICENSE](./LICENSE).

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
> This first implementation batch is **planning-only**. It produces the exact
> update branches and pull requests it would manage, but deliberately refuses
> `dry-run: false` until Zolt publishes its canonical exact-target update
> contract. Pin the action to a reviewed full commit SHA.

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

The action currently implements the complete read and planning half of the
update pipeline:

1. It validates that the run belongs to the repository and its default branch.
2. It materializes tracked blobs from the exact `GITHUB_SHA` into a private
   directory. Dirty checkout files are ignored.
3. It downloads one embedded Zolt release, verifies its SHA-256, validates its
   archive layout, extracts it privately, and verifies its exact version.
4. It gives Zolt a minimal environment plus only the repository credential
   variables named by `registry-env`.
5. It runs `zolt outdated --format json` and strictly decodes the stable v1
   schema. Unknown fields, schemas, surfaces, and statuses fail closed.
6. It applies the update ceiling and pull-request limit, preserving version
   alias fan-out as one logical target.
7. It derives provisional stable target identities, managed branch names,
   pull-request titles, ownership markers, and summaries.
8. It refuses write mode before any repository mutation or GitHub branch call.

The pinned Zolt version is the same workspace-capable release used by
`zoltsh/submit-dependencies` in this implementation batch.

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

The current `pzt1_…` target identifiers and `zolt/update/…` branch names are
explicitly provisional. They are derived from the canonical manifest path,
surface, section, and identifier. The destination version is deliberately not
part of the identity, allowing a future managed pull request to refresh in
place.

Zolt—not this action—must ultimately issue the authoritative target ID. See
[Zolt automation contract](./docs/ZOLT_CONTRACT.md).

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
| [Zolt contract](./docs/ZOLT_CONTRACT.md) | Implement the exact-target contract that unlocks write mode |
| [Canary guide](./docs/CANARY.md) | Exercise planning against standalone and workspace fixtures |
| [Release guide](./docs/RELEASING.md) | Publish a reviewed JavaScript Action release |

## Development

Use Node 24 or newer.

```sh
npm ci
scripts/check
```

`check` verifies types, repository style and security rules, all tests, the
committed runtime tree, and Action metadata. CI additionally runs `actionlint`,
`npm audit`, dependency review, and the supported runner matrix.

The committed `dist/` directory is the Action runtime. This batch has no runtime
npm dependencies: TypeScript compiles the source into an ESM module tree that
runs under GitHub Actions Node 24.

## License

MIT. See [LICENSE](./LICENSE).

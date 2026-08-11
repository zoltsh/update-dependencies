<p align="center">
  <img src="https://raw.githubusercontent.com/zoltsh/zolt/main/logo.svg" alt="zolt" width="720">
</p>

<h3 align="center">Update Zolt dependencies on GitHub</h3>

<p align="center">
  Verified pull requests for standalone projects, workspaces, and shared version aliases.
</p>

<p align="center">
  <a href="#use">Use</a>
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
> Pin this action to a reviewed full commit SHA.

## Use

Run on the default branch. Pin checkout and this action to full commit SHAs.

```yaml
name: Update Zolt dependencies

on:
  schedule:
    - cron: "17 9 * * 1"
  workflow_dispatch:

concurrency:
  group: zolt-dependency-updates-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: write
  pull-requests: write

jobs:
  update:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@<full-commit-sha>
        with:
          persist-credentials: false

      - uses: zoltsh/update-dependencies@<full-commit-sha>
        with:
          dry-run: false
```

GitHub requires `contents: write` and `pull-requests: write` to publish managed
updates. In **Settings → Actions → General**, enable **Allow GitHub Actions to
create and approve pull requests**. The action rejects pull requests, merge
queues, non-default branches, and cross-repository publication.

`dry-run: true` is the default. It produces the same deterministic plan and job
summary without creating branches or pull requests.

## What it does

Before downloading or running Zolt, the action copies tracked files from the
exact `GITHUB_SHA` into a private directory. Dirty checkout files cannot change
the update plan or published artifact.

The action downloads and verifies a checksum-pinned Zolt release, discovers
available updates, and applies the configured ceiling, prerelease policy,
selectors, and concurrent pull-request limit.

Each published update starts from a fresh copy of the exact commit. Only the
selected manifest and root lockfile may change, and a locked offline resolve
must pass before GitHub receives any write.

Repeated runs refresh Action-owned pull requests, leave identical updates
unchanged, and close obsolete updates. Human-modified branches, duplicate
ownership markers, unexpected files, and ref races block instead of overwriting
work.

## Inputs

| Input | Default | Meaning |
| :--- | :---: | :--- |
| `directory` | `.` | Project directory, or a directory inside the workspace |
| `workspace` | `auto` | `auto`, `true`, or `false` |
| `github-token` | `github.token` | Token used for managed branches and pull requests |
| `update-ceiling` | `minor` | Largest update class: `patch`, `minor`, or `major` |
| `include-prereleases` | `false` | Allow prerelease update targets |
| `selectors` | — | Coordinates, aliases, sections, or members, one per line |
| `open-pull-requests-limit` | `5` | Maximum concurrent managed update pull requests |
| `registry-env` | — | Repository credential variable names passed to Zolt, one per line |
| `dry-run` | `true` | Plan without creating or reconciling pull requests |

### Private repositories

Pass only the credential variables Zolt needs:

```yaml
- uses: zoltsh/update-dependencies@<full-commit-sha>
  env:
    MAVEN_USERNAME: ${{ secrets.MAVEN_USERNAME }}
    MAVEN_PASSWORD: ${{ secrets.MAVEN_PASSWORD }}
  with:
    dry-run: false
    registry-env: |
      MAVEN_USERNAME
      MAVEN_PASSWORD
```

GitHub credential channels cannot be selected. Named values are masked and
redacted, and the GitHub token is never passed to Zolt.

## Limits

The immutable repository view accepts at most 50,000 tracked entries, 512 MiB
in total, and 256 MiB for one blob. Each publishable manifest or lockfile is
limited to 16 MiB.

## Workspaces

`workspace: auto` searches upward for a workspace. `workspace: true` requires
one. `workspace: false` updates only the selected project.

Both modern workspaces declared in `zolt.toml` and legacy
`zolt-workspace.toml` files are supported. Root members and shared `[versions]`
aliases remain one managed update target.

## Outputs

| Output | Meaning |
| :--- | :--- |
| `planned-update-count` | Updates selected for planning or publication |
| `deferred-update-count` | Eligible updates deferred by the PR limit |
| `blocked-update-count` | Updates or managed PRs that cannot be changed safely |
| `plan` | Deterministic JSON array of selected updates |
| `created-pull-request-count` | Pull requests created in this run |
| `updated-pull-request-count` | Pull requests refreshed in this run |
| `closed-pull-request-count` | Pull requests closed in this run |
| `zolt-version` | Verified Zolt version used by the action |

## Runners

Supported targets are `linux-x64`, `linux-arm64`, `macos-x64`, and
`macos-arm64`. Windows is not supported.

The action supports GitHub.com only. GitHub Enterprise Server is not currently
supported.

## Compatibility

The action uses Zolt's authoritative outdated and exact-update schema 2. It
bundles Zolt `0.1.0-zap.20260810.ae6532ef804c` from source commit
[`ae6532ef804c6347c6b1e72742216b9443c6c288`](https://github.com/zoltsh/zolt/commit/ae6532ef804c6347c6b1e72742216b9443c6c288).

## Read more

| Read | When you need it |
| :--- | :--- |
| [Architecture](./docs/ARCHITECTURE.md) | Understand execution and managed PR rules |
| [Security](./SECURITY.md) | Review what the action trusts and rejects |
| [Release guide](./docs/RELEASING.md) | Publish an action release |
| [Canary guide](./docs/CANARY.md) | Test real Zolt and GitHub publication behavior |

## Development

Use Node 24 or newer. GitHub runs the committed bundle with Node 24.

```sh
npm ci
scripts/check
```

`scripts/check` checks types and style, runs the tests, compares the committed
`dist/` bundle, and validates the action and workflows.

## License

MIT. See [LICENSE](./LICENSE).

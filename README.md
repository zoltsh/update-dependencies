<p align="center">
  <img src="https://raw.githubusercontent.com/zoltsh/zolt/main/logo.svg" alt="zolt" width="560">
</p>

<h3 align="center">Keep Zolt dependencies current</h3>

<p align="center">
  One verified pull request per dependency update, with workspace and version-alias support.
</p>

## Use

```yaml
name: Update dependencies

on:
  schedule:
    - cron: "17 9 * * 1"
  workflow_dispatch:

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
          update-ceiling: minor
          open-pull-requests-limit: 5
```

Pin both actions to reviewed full commit SHAs. The default `dry-run: true`
produces the same plan and job summary without writing to GitHub.

## Behavior

The action runs a checksum-pinned Zolt release against the exact triggering
commit. Each selected update is applied in isolation, checked for unexpected
files, and verified with a locked offline resolve before its branch is
published. Repeated runs refresh owned pull requests, close updates that are no
longer needed, and leave human-modified branches alone.

It supports standalone projects, modern and legacy workspaces, shared version
aliases, and explicitly allowlisted private-repository credentials on GitHub.com
Linux and macOS runners.

## Inputs

| Input | Default | Purpose |
| :--- | :---: | :--- |
| `directory` | `.` | Project or workspace directory |
| `workspace` | `auto` | `auto`, `true`, or `false` |
| `update-ceiling` | `minor` | `patch`, `minor`, or `major` |
| `include-prereleases` | `false` | Allow prerelease targets |
| `selectors` | — | Coordinates, aliases, sections, or members, one per line |
| `open-pull-requests-limit` | `5` | Maximum concurrent managed update PRs |
| `registry-env` | — | Credential environment variable names passed to Zolt |
| `dry-run` | `true` | Plan without creating or reconciling PRs |

See [Security](./SECURITY.md), [Architecture](./docs/ARCHITECTURE.md), and
[Releasing](./docs/RELEASING.md) for the trust model and maintenance details.

## Development

```sh
npm ci
scripts/check
```

Requires Node 24 or newer. MIT licensed.

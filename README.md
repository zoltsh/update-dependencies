<p align="center">
  <img src="https://raw.githubusercontent.com/zoltsh/zolt/main/logo.svg" alt="zolt" width="720">
</p>

<h3 align="center">Plan Zolt dependency updates safely</h3>

<p align="center">
  Deterministic update plans from the exact Git commit, powered by a verified Zolt release.
</p>

<p align="center">
  <a href="#use">Use</a>
  <span> · </span>
  <a href="#inputs">Inputs</a>
  <span> · </span>
  <a href="./SECURITY.md">Security</a>
  <span> · </span>
  <a href="#development">Development</a>
</p>

<br />

> [!IMPORTANT]
> Pin this action to a reviewed full commit SHA. This release creates update
> plans; it does not change files or open pull requests.

## Use

Run the action on a schedule or with `workflow_dispatch`:

```yaml
name: Plan Zolt dependency updates

on:
  schedule:
    - cron: "17 9 * * 1"
  workflow_dispatch:

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
          update-ceiling: minor
          open-pull-requests-limit: 5
```

The job summary shows which updates are selected, deferred, blocked, or outside
policy. The `plan` output contains the same result as deterministic JSON.

## What it does

- Reads tracked project files from the exact triggering commit, ignoring dirty
  checkout files.
- Downloads and verifies a checksum-pinned Zolt release.
- Finds available updates for standalone projects and workspaces.
- Applies the configured version ceiling, prerelease policy, selectors, and
  update limit.
- Produces stable target identities, counts, pull-request previews, and JSON
  output for review or downstream automation.

The action fails closed on unsupported events, non-default-branch runs, malformed
Zolt output, unexpected repository state, and unapproved credential channels.
It supports GitHub.com on Linux and macOS; Windows and GitHub Enterprise Server
are not supported.

## Inputs

| Input | Default | Meaning |
| :--- | :---: | :--- |
| `directory` | `.` | Project directory, or a directory inside the workspace |
| `workspace` | `auto` | Workspace discovery: `auto`, `true`, or `false` |
| `update-ceiling` | `minor` | Largest allowed update: `patch`, `minor`, or `major` |
| `include-prereleases` | `false` | Include prerelease versions |
| `selectors` | — | Coordinates, aliases, sections, or members, one per line |
| `open-pull-requests-limit` | `5` | Maximum updates selected in one run |
| `registry-env` | — | Repository credential variable names, one per line |
| `dry-run` | `true` | Planning mode; `true` is the supported value |

`workspace: auto` supports modern workspaces declared in `zolt.toml`, legacy
`zolt-workspace.toml` workspaces, and standalone projects.

For private Maven repositories, pass only the credential variables Zolt needs:

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

Selected credentials are masked, redacted, and never mixed with the GitHub
token.

## Read more

- [Architecture](./docs/ARCHITECTURE.md)
- [Security](./SECURITY.md)
- [Zolt contract](./docs/ZOLT_CONTRACT.md)
- [Canary guide](./docs/CANARY.md)
- [Release guide](./docs/RELEASING.md)

## Development

Use Node 24 or newer:

```sh
npm ci
scripts/check
```

The repository commits the complete `dist/` runtime used by GitHub Actions.

## License

MIT. See [LICENSE](./LICENSE).

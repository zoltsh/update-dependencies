# Canary

The canary verifies the Action against real GitHub event and runner behavior
without enabling writes.

## Fixtures

Keep small repositories for:

1. A standalone Zolt project with one patch and one minor update.
2. A modern workspace with updates in two members and one root lock.
3. A legacy `zolt-workspace.toml` workspace.
4. A shared `[versions]` alias with multi-coordinate fan-out.
5. A private basic-auth Maven repository.
6. A private bearer-token Maven repository.
7. A dependency whose metadata lookup is unavailable.
8. A generated-tool literal that Zolt reports but cannot currently mutate.

## Run

Pin checkout and this Action to reviewed full commit SHAs. Run through
`workflow_dispatch` with `dry-run: true`. Store the `plan` output as a workflow
artifact and compare it with the reviewed fixture.

## Require

- The exact expected Zolt version and target checksum are logged.
- The selected manifest and root lock paths are correct.
- Patch updates precede minor updates, which precede major updates.
- Alias fan-out remains one target.
- The pull-request limit defers rather than drops targets.
- Unknown discovery and unsupported literal tooling are blocked.
- Private credentials are masked and absent from logs, outputs, and summaries.
- A second run against the same commit produces identical plan JSON.
- `dry-run: false` fails before any branch or pull-request operation.

# Zolt automation contract

The first Action batch intentionally consumes only the existing stable
`zolt outdated --format json` schema v1. Pull-request writes require a stronger
Zolt-owned contract so the Action never reimplements manifest semantics.

## Canonical target inventory

Add a compatibility-preserving automation schema, for example:

```console
zolt outdated --workspace --format json --schema-version 2
```

Every mutable version surface should include:

```json
{
  "targetId": "zt1_xVvT5YFKwYpLP9cJ",
  "manifestPath": "apps/api/zolt.toml",
  "lockfilePath": "zolt.lock",
  "workspaceRoot": ".",
  "surface": "dependency",
  "identifier": "com.google.guava:guava",
  "section": "[dependencies]",
  "current": "33.3.1-jre",
  "updateable": true,
  "governs": [],
  "members": ["apps/api"]
}
```

`targetId` must be opaque, deterministic, and independent of the current or
candidate version. Its semantic identity should include the target schema,
canonical manifest path, surface, section, and identifier.

A coordinate alone is not sufficient: it may occur in several scopes or
members, be governed by a version alias, or represent a platform rather than a
normal dependency.

## Exact mutation

Automation should invoke:

```console
zolt update \
  --target-id zt1_xVvT5YFKwYpLP9cJ \
  --to 33.4.0-jre \
  --format json \
  --schema-version 2
```

Required behavior:

- `--to` requires exactly one target.
- `--target-id` is mutually exclusive with update-ceiling selection.
- The command may start at the workspace root and route to the correct member.
- The existing fail-closed manifest/root-lock transaction performs the write.
- Reapplying the same version is a successful no-op.
- Downgrades fail unless explicitly enabled by a future option.
- SNAPSHOT destinations fail.
- Prerelease destinations require explicit opt-in.
- Resolution failure changes neither manifest nor lock.
- The requested version may resolve even when repository metadata did not list
  it, which is necessary for incomplete private repositories and advisory-
  selected security versions.

A successful document should report:

```json
{
  "schemaVersion": 2,
  "command": "update",
  "status": "ok",
  "target": {
    "targetId": "zt1_xVvT5YFKwYpLP9cJ",
    "manifestPath": "apps/api/zolt.toml",
    "lockfilePath": "zolt.lock",
    "surface": "dependency",
    "identifier": "com.google.guava:guava",
    "section": "[dependencies]"
  },
  "from": "33.3.1-jre",
  "to": "33.4.0-jre",
  "class": "minor",
  "changed": true,
  "resolved": true,
  "changedFiles": [
    "apps/api/zolt.toml",
    "zolt.lock"
  ],
  "fanOut": [],
  "diagnostics": []
}
```

The Action will require exact fields and reject any changed path outside the
reported manifest and canonical root lock.

## Offline direct-dependency inventory

Before native Dependabot integration, add:

```console
zolt dependencies inventory --workspace --format json
```

It should describe every direct declaration, including literals, aliases,
platform-managed versions, SNAPSHOTs, workspace dependencies, constraints,
generated tools, requirement source, effective version, owning manifest and
section, and target ID when writable.

Dependabot's `FileParser` can consume this contract instead of implementing a
second Zolt TOML model in Ruby.

## Release dates

Cooldown support needs a target-scoped versions contract:

```console
zolt versions --target-id TARGET --format json
```

Each version should include a nullable release timestamp, source repository,
and release-date provenance. Dates must never be guessed. For an alias that
governs several coordinates, a candidate is valid only when every governed
coordinate provides it; the effective release date is the latest component
release date.

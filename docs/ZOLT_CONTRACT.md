# Zolt automation contract

Zolt's schema-v2 exact-target contract is implemented on `zoltsh/zolt` main at
source commit `ae6532ef804c6347c6b1e72742216b9443c6c288`. CI builds that exact
source and runs the downstream contract canary.

The public Action still pins an older immutable Zolt build that exposes stable
`zolt outdated --format json` schema v1. Source-contract support and production
release selection are intentionally separate: write mode stays closed until a
matching release, four archive checksums, and the publication orchestrator land
together.

## Canonical target inventory

The schema-v2 Action path invokes:

```console
zolt outdated --format json --schema-version 2
```

Workspace behavior is inferred from the command directory. There is no separate
`--workspace` flag on `outdated`.

A scope is mutation-root-relative:

```json
{
  "label": "apps/api",
  "manifestPath": "apps/api/zolt.toml",
  "lockfilePath": "zolt.lock",
  "entries": []
}
```

Every entry retains the schema-v1 fields and adds:

```json
{
  "targetId": "zt1_vcc-lFhiR4a_S4Vab01gw0_gcPDgShIiT8IdjXa5MhM",
  "updateable": true,
  "updateBlocker": null,
  "surface": "dependency",
  "identifier": "com.google.guava:guava",
  "section": "[dependencies]",
  "current": "33.3.1-jre",
  "status": "update-available",
  "candidates": {
    "patch": null,
    "minor": "33.4.0-jre",
    "major": "34.0.0-jre"
  },
  "selectedInMajor": "33.4.0-jre",
  "selectedInMajorClass": "minor",
  "selectedLatest": "34.0.0-jre",
  "selectedLatestClass": "major",
  "source": "central",
  "governs": [],
  "members": [],
  "notes": []
}
```

`targetId` is deterministic, independent of current/candidate versions, and
scoped to one mutation root. The Action does not merely validate its syntax: it
recomputes the ID from SHA-256 over the domain `zolt-update-target\0`, version
byte `1`, and four big-endian-length-prefixed UTF-8 fields: canonical manifest
path, surface JSON name, section, and identifier. A coordinate alone is not sufficient: it may
occur in several sections or members, be governed by an alias, or represent a
platform rather than a normal dependency.

`updateable: false` requires a non-null blocker. Updateable targets require a
null blocker.

## Exact mutation

The exact-update executor invokes one target and one caller-selected destination:

```console
zolt update \
  --target-id zt1_vcc-lFhiR4a_S4Vab01gw0_gcPDgShIiT8IdjXa5MhM \
  --to 33.4.0-jre \
  --format json \
  --schema-version 2
```

Required behavior:

- `--to` and `--target-id` select exactly one declaration.
- Exact mode never consults Maven metadata; the staged resolve proves the fixed
  destination is available.
- The command may start at a workspace root and route to the owning member.
- The existing fail-closed manifest/root-lock transaction performs the write.
- Reapplying the same version is a successful no-op.
- Downgrades, ranges, dynamic versions, interpolation, and SNAPSHOT destinations
  fail.
- Prerelease destinations require explicit opt-in.
- Resolution failure changes neither manifest nor lock.
- `--no-resolve` may change only the manifest and reports `resolved: false`.

A normal applied result is:

```json
{
  "schemaVersion": 2,
  "command": "update",
  "status": "ok",
  "dryRun": false,
  "target": {
    "targetId": "zt1_vcc-lFhiR4a_S4Vab01gw0_gcPDgShIiT8IdjXa5MhM",
    "manifestPath": "apps/api/zolt.toml",
    "lockfilePath": "zolt.lock",
    "surface": "dependency",
    "identifier": "com.google.guava:guava",
    "section": "[dependencies]",
    "updateable": true
  },
  "from": "33.3.1-jre",
  "to": "33.4.0-jre",
  "class": "minor",
  "changed": true,
  "applied": true,
  "resolved": true,
  "changedFiles": [
    "apps/api/zolt.toml",
    "zolt.lock"
  ],
  "fanOut": [],
  "diagnostics": []
}
```

`changedFiles` contains actual byte-changed mutation-root-relative files in
manifest-then-lock order. It is empty for dry-run and no-op. The Action maps
those paths into the repository root and independently requires the observed
filesystem changes to match exactly.

## Machine failures

JSON-mode failures use the requested schema version on standard output and keep
standard error empty:

```json
{
  "schemaVersion": 2,
  "command": "update",
  "status": "failed",
  "diagnostics": [
    {
      "severity": "error",
      "message": "Unknown Zolt update target.",
      "nextStep": "Run zolt outdated again."
    }
  ]
}
```

The Action strictly decodes this envelope and surfaces the bounded diagnostic
rather than logging raw machine JSON. Wrong commands, schemas, fields,
severities, empty diagnostics, or non-empty standard error fail closed.

## Action-side managed identity

Zolt target IDs are scoped to one mutation root. The Action derives a
repository-level managed ID from length-prefixed SHA-256 input:

```text
"zolt-update-dependencies-managed-target-v1"
repository-relative selected Zolt root
authoritative Zolt target ID
```

The destination version is excluded, allowing one stable branch and PR to
refresh to later targets.

## Offline direct-dependency inventory

Before native Dependabot integration, Zolt should add an offline direct
inventory contract. It should describe literals, aliases, platform-managed
versions, SNAPSHOTs, workspace dependencies, constraints, generated tools,
requirement source, effective version, owning manifest and section, and target
ID when writable. Dependabot's `FileParser` can consume that instead of
implementing a second Zolt TOML model in Ruby.

## Release dates

Cooldown support needs a target-scoped versions contract. Each version should
include a nullable release timestamp, source repository, and release-date
provenance. Dates must never be guessed. For an alias governing several
coordinates, a candidate is valid only when every governed coordinate provides
it; its effective release date is the latest component release date.

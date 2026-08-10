# Architecture

`update-dependencies` turns the dependency-update candidates reported by one
verified Zolt binary into a deterministic set of future managed pull requests.
The first implementation batch stops before all writes.

```text
trusted event + exact GITHUB_SHA
              |
              v
 immutable private repository view
              |
              v
 checksum-pinned Zolt installation
              |
              v
 strict outdated JSON v1 decode
              |
              v
 policy + limit + provisional identity
              |
              v
 PR title, branch, marker, and job summary preview
              |
              v
       write gate (closed)
```

The write gate remains closed until the Zolt contract in
[`ZOLT_CONTRACT.md`](./ZOLT_CONTRACT.md) is available in the pinned release.

## Modules

| Module | Responsibility |
| :--- | :--- |
| `action` | Small GitHub Actions command, output, secret, and summary adapter |
| `environment` | Validate the event and materialize the exact commit into a private view |
| `install` | Download, hash, inspect, extract, and version-check the pinned Zolt archive |
| `zolt` | Discover project/workspace scope, isolate credentials, execute Zolt, and decode JSON |
| `planner` | Select policy-compliant updates and derive provisional stable identities |
| `github` | Render future branch, pull-request, ownership-marker, and summary previews |
| `main` | Compose the boundaries and guarantee cleanup on success or failure |

## Rules

1. The checkout is only a Git object source. Analysis reads a private copy of
   tracked files at the exact `GITHUB_SHA`.
2. `GITHUB_WORKSPACE` must be the checkout root. Symlinks, submodules,
   unsupported modes, path escapes, case collisions, and configured size limits
   fail before extraction.
3. The action runs one exact Zolt version with one SHA-256 per supported target.
4. Archives may contain one expected executable and no links, special files,
   traversal paths, privilege bits, duplicate paths, or unexpected executables.
5. Zolt runs by absolute path with an argument array and no shell.
6. Zolt receives a minimal environment and explicitly selected Maven credential
   values. It never receives the GitHub pull-request token.
7. Machine output is size-bounded, valid UTF-8, and strictly decoded. Unknown
   schema fields are errors rather than forward-compatible guesses.
8. Version aliases remain one logical target, including their complete fan-out.
9. Patch updates sort before minor updates, which sort before major updates.
   Ordering is deterministic within a class.
10. Every selected target names exactly one manifest and one canonical lockfile.
11. Generated-tool literals that current Zolt cannot mutate are reported as
    blocked, never silently edited.
12. `dry-run: false` fails before repository mutation or GitHub write calls.
13. Public diagnostics are control-stripped, bounded, and redacted.
14. Temporary installations, credential homes, and repository views are cleaned
    up independently; cleanup failure marks the Action failed.

## Planning model

One planned target contains:

- current and destination versions;
- patch, minor, or major classification;
- dependency surface and section;
- canonical manifest and root lock paths;
- alias fan-out and workspace attribution;
- source repository and Zolt notes;
- a provisional target ID and stable branch hash.

The pull-request limit is applied after deterministic sorting. Extra eligible
targets are `deferred`, metadata-discovery failures and unsupported writable
surfaces are `blocked`, and updates beyond the selected ceiling are
`outsidePolicy`.

## Write-path design

When the exact-target Zolt contract lands, the next architecture slice is:

```text
selected target
      |
      v
fresh private base copy per target
      |
      v
zolt update --target-id ID --to VERSION --format json
      |
      v
locked/offline verification + changed-file allowlist
      |
      v
GitHub blob/tree/commit/ref APIs
      |
      v
managed PR reconciliation
```

Each target must begin from the same current default-branch commit. The future
GitHub adapter must not use checkout credentials or `git push`; Maven
credentials and GitHub write credentials remain in separate adapters.

## Compatibility

Each Action release owns its embedded Zolt version and supported machine schema.
Adding a Zolt schema is an explicit code and fixture change. Provisional target
identities are not yet a compatibility promise. Authoritative Zolt target IDs,
managed marker formats, branch reconciliation rules, and changed-file policy
will become release contracts when write mode ships.

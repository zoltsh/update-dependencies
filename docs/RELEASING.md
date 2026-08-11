# Releasing

Action releases use the JavaScript committed in `dist/`. The project does not
publish an npm package.

## Prepare

1. Set `ACTION_VERSION` in `src/constants.ts` to the immutable version tag
   without the leading `v`.
2. Confirm the reviewed source contract in
   `src/generated/zolt-source-contract.ts` passes CI, then update
   `src/generated/zolt-release.ts` with one immutable published Zolt version,
   its source commit, four archive checksums, and the exact outdated schema
   version that release supports.
3. Run `npm ci`, `npm audit`, `npm run bundle`, and `scripts/check` under Node 24.
4. Run `actionlint` against every workflow.
5. Confirm the reviewed-source exact-target canary, supported runner matrix,
   and Windows rejection tests pass.
6. Run planning canaries for standalone, modern/legacy workspace, alias fan-out,
   and private repositories.
7. When schema v2 is selected, run real exact-update artifact canaries plus the
   managed-marker, reconciliation, and GitHub API adapter suites even if
   publication remains closed.
8. Review the source diff, complete `dist/` diff, and `dist/licenses.txt`.
9. Confirm `main` is clean and protected.

Changing `ZOLT_OUTDATED_SCHEMA_VERSION` from `1` to `2` is a release-critical
contract change. Do not make it without pinning the exact Zolt build whose
fixtures and live executor canaries passed.

## Publish

1. Create an OpenPGP-signed annotated version tag on the reviewed commit.
2. Push the immutable tag.
3. Create a GitHub release from the tag.
4. Move compatibility tags such as `v0` and `v0.1` only after the immutable
   versioned release is public and verified.
5. Update consuming workflows to the release commit's full SHA.

Do not rebuild `dist/` while tagging. The reviewed commit is the release
artifact.

## Verify

- Confirm the tag resolves to the reviewed signed commit.
- Run a consumer workflow pinned to that full SHA.
- Confirm the expected Zolt version, schema selector, and deterministic plan.
- Confirm a repeated run is byte-equivalent.
- Confirm write mode remains rejected unless that release explicitly enables
  the reviewed publication orchestrator.
- Confirm pull-request events, non-default branches, Windows, malformed machine
  documents, bad archive checksums, missing credentials, unexpected update
  files, marker collisions, and human-modified heads fail closed without
  leaking sensitive values.

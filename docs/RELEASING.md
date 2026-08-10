# Releasing

Action releases use the JavaScript committed in `dist/`. The project does not
publish an npm package.

## Prepare

1. Set `ACTION_VERSION` in `src/constants.ts` to the immutable version tag
   without the leading `v`.
2. Update `src/generated/zolt-release.ts` with one published Zolt version, its
   source commit, and all four archive checksums.
3. Run `npm ci`, `npm audit`, `npm run bundle`, and `scripts/check`.
4. Run `actionlint` against every workflow.
5. Confirm the supported runner matrix and Windows rejection tests pass.
6. Run the planning canary for standalone, modern workspace, legacy workspace,
   alias fan-out, and private repository fixtures.
7. Review the source diff, complete `dist/` diff, and `dist/licenses.txt`.
8. Confirm `main` is clean and protected.

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
- Run a consumer workflow pinned to that full commit SHA.
- Confirm the expected Zolt version and deterministic `plan` output.
- Confirm a second identical run produces byte-equivalent plan JSON.
- Confirm `dry-run: false`, pull-request events, non-default branches, Windows,
  malformed Zolt JSON, bad archive checksums, and missing private credentials
  fail closed without leaking sensitive values.

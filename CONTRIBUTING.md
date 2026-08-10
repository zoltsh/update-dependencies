# Contributing

## Development

Use Node 24 or newer. Install exactly the locked development dependencies and
run the repository check:

```sh
npm ci
scripts/check
```

The Action runtime is committed under `dist/`. Change source and tests first,
then run:

```sh
npm run bundle
scripts/check
```

A pull request must include the regenerated `dist/` tree. Do not hand-edit
compiled files.

## Design boundaries

- Keep write mode disabled until the canonical exact-target Zolt contract is
  published and pinned.
- Do not parse human-readable Zolt output.
- Do not introduce shell command construction; use argument arrays.
- Do not pass GitHub credentials to Zolt or Maven credentials to GitHub code.
- Treat unknown machine fields, repository objects, archive entries, and changed
  files as failures.
- Add a regression test for every security or transaction failure fixed.

## Commits

Use focused commits with conventional subjects, for example:

```text
feat(planner): derive stable update previews
fix(repository): accept padded ls-tree blob sizes
```

## Vulnerabilities

Report suspected vulnerabilities privately as described in
[SECURITY.md](./SECURITY.md).

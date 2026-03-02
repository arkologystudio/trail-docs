# Publishing Checklist

Use this checklist before tagging and publishing.

## Code and Tests

1. `npm test` passes locally.
2. CI passes on supported Node versions.
3. No unintended workspace artifacts are committed.

## Documentation

1. `README.md` command examples match CLI behavior.
2. `docs/doc-nav-quick-start.md` includes current workflows.
3. `docs/json_output_schema.md` matches actual `--json` output.
4. `CHANGELOG.md` has an entry for the target release.

## Packaging

1. `package.json` version is correct.
2. `package.json` metadata is complete (`license`, `repository`, `bugs`, `homepage`, `files`).
3. `LICENSE` and `CONTRIBUTING.md` are present.
4. `npm pack --dry-run` output is reviewed.

## Security and Provenance

1. `fetch` policy behavior validated with a `doc-nav.policy.json` sample.
2. `build --source-manifest` path tested.
3. `cite` and `use` include expected provenance fields for external docs.

## Release Steps

1. Update `CHANGELOG.md` and commit.
2. Bump version (`npm version <x.y.z>`).
3. Tag and push.
4. Publish (`npm publish --access public`) or run release workflow.
5. Verify package install and smoke test:

```bash
npm install -g doc-nav@<x.y.z>
doc-nav --help
```

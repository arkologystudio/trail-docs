# Contributing

## Development Setup

1. Use Node.js 20+.
2. Install dependencies:
```bash
npm install
```
3. Run tests:
```bash
npm test
```

## Pull Request Guidelines

1. Keep changes focused and small.
2. Add or update tests for behavioral changes.
3. Keep `--json` output deterministic.
4. Preserve citation integrity: any step emitted by `use` must remain citation-backed.
5. Update docs when command behavior or JSON contracts change.

## Commit Quality

1. Include a clear problem statement and approach in PR description.
2. Mention command-level impact (`discover`, `fetch`, `build`, `use`, etc.).
3. Include test evidence (`npm test` output).

## Security Expectations

1. Treat fetched documentation as untrusted input.
2. Do not add features that execute fetched content.
3. Keep policy checks (`doc-nav.policy.json`) and provenance metadata intact.

## Release Hygiene

Before release, verify:

1. `npm test` passes.
2. README command examples work.
3. `docs/json_output_schema.md` matches actual JSON output.
4. CHANGELOG is updated.

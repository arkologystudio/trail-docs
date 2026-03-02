# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- `discover` command for multi-provider library discovery (`catalog`, `npm`, `github`).
- `fetch` command for pre-install documentation acquisition and local snapshotting.
- `surface` command for deterministic JS/TS API extraction (exports, symbols, signatures, and examples).
- `fn` command for symbol-level lookup with callable/type citations.
- `use --libs` mode for task-to-callable routing across multiple library selectors.
- `prep`/`index` one-shot pipeline for discover/fetch/build/manifest.
- `use` auto-heal mode that attempts prep when manifest/index resolution fails.
- `search --indexes` and `use --indexes` federated multi-index query modes.
- Project-level `trail-docs.toml` defaults (library/index/manifest/trust/federation/output).
- Source provenance manifest (`.trail-docs/source.json`) including canonical URL, requested/resolved refs, integrity, and trust signals.
- Optional source provenance in `cite` and `use` (`citation_details`).
- Security policy support via `trail-docs.policy.json` with host, extension, and size/file limits.
- New deterministic errors for discovery/fetch/policy flows.
- Bootstrap extraction now includes operational/runtime signals from files like `package.json`, `Makefile`, `Dockerfile`, and CI workflows (`signals_detected`).
- Shared source-resolution helpers moved into `src/source-resolver.mjs` and reused by fetch/surface flows.

### Changed
- `build` now accepts `--source-manifest` to embed external source provenance in the index.
- `use` ranking and filtering improved for practical how-to tasks (reduced changelog/meta noise, better command-oriented section selection).
- Surface extraction now caches parsed artifacts under `.trail-docs/cache/surfaces`.
- Query tokenization now removes common stopwords for improved relevance.
- Bootstrap indexes now persist inferred build metadata (`build.inferred`, `build.derivation`), surfaced by `stats`.
- `use` now returns overall `confidence: "partial"` when querying bootstrap-derived/inferred indexes.
- Bootstrap generated docs now include file+line provenance for routes and environment variables.

## [0.1.0] - 2026-02-27

### Added
- Initial release of `trail-docs` with `bootstrap`, `build`, `list`, `stats`, `search`, `open`, `cite`, and `use`.
- Deterministic markdown indexing and citation-backed retrieval.
- JSON output mode for all commands.
- Fixture-based integration tests.

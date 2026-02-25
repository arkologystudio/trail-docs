# DocCLI MVP Implementation Plan

## Sprint Goal

Deliver a working `doccli` that another developer can run locally in under 5 minutes to build and query docs with deterministic JSON outputs.

## Duration

10 working days (single sprint), with a releasable cut by day 8 and hardening on days 9-10.

## Workstreams

### 1) CLI Foundation
Deliverables:
- TypeScript project scaffold.
- Binary entrypoint `doccli`.
- Shared output layer (human + `--json`).
- Standardized error and exit-code handling.

Definition of done:
- `doccli --help` and subcommand help complete.
- Argument parsing and validation tested.

### 2) Markdown Ingestion and Index Build
Deliverables:
- Markdown walker and parser.
- Heading/anchor extraction.
- Section and code block extraction.
- Deterministic index writer.

Definition of done:
- `doccli build` generates `.doccli/index.json`.
- Repeated builds on unchanged docs produce identical content hash.

### 2.5) Codebase Bootstrap
Deliverables:
- `bootstrap` command for code-first repositories.
- Source scanning for symbols, routes, and env vars.
- Generated markdown in `.doccli/generated-docs`.
- Optional manifest emission for immediate `use` compatibility.

Definition of done:
- `doccli bootstrap` generates docs and index without hand-written docs.
- Output marked with `confidence: partial`.

### 3) Retrieval Commands
Deliverables:
- `search` lexical scoring with deterministic tie-breakers.
- `open` section resolver with bounded content.
- `cite` canonical provenance output.

Definition of done:
- Results include required provenance fields.
- Output conforms to spec examples.

### 4) Task Command (`use`)
Deliverables:
- Library resolution flow (`--path`, `DOCCLI_PATHS`, package lookup).
- Task-to-steps composer using retrieved sections.
- Citation attachment for each step.

Definition of done:
- `doccli use <library> "<task>"` returns actionable steps and citations.
- No uncited steps in output.

### 5) Quality and Packaging
Deliverables:
- Fixture-based integration tests.
- Schema validation tests.
- npm package setup and quickstart docs.

Definition of done:
- Core command tests pass.
- Install and run documented for maintainers.

## Day-by-Day Sequence

Day 1:
- Initialize project structure.
- Implement CLI command shells and shared output/error types.

Day 2-3:
- Implement Markdown ingestion and anchor normalization.
- Finalize index schema structs and build pipeline.

Day 3:
- Implement `bootstrap` code scanning and generated markdown output.

Day 4:
- Implement `search` with scoring and deterministic sorting.

Day 5:
- Implement `open` and `cite`.
- Add provenance fields and payload-bounding flags.

Day 6:
- Implement `use` orchestration and citation coverage checks.

Day 7:
- Add Node package discovery and `--path`/`DOCCLI_PATHS`.

Day 8:
- Integration tests from fixtures.
- Produce release candidate (`v0.1.0-rc.1`).

Day 9-10:
- Bug fixes only.
- Docs polish and final release cut (`v0.1.0`).

## Test Strategy

Priority tests:
- Golden-file tests for `--json` outputs.
- Determinism tests (repeat-run equality).
- Exit code tests per error class.
- `use` validation that every step has citations.

Non-goals in sprint:
- Benchmark suite.
- Fuzzing.
- Cross-language package resolvers beyond initial Node support.

## Risks and Mitigations

Risk: inconsistent anchors across Markdown dialects.
Mitigation: implement one anchor normalization algorithm and freeze in tests.

Risk: low-quality `use` responses from sparse docs.
Mitigation: return `confidence: partial` and include fewer but cited steps.

Risk: command payloads too large for agents.
Mitigation: enforce defaults for `--max-results` and `--max-chars`.

## Release Checklist

- Versioned CLI binary published.
- Spec docs committed.
- Fixtures and tests green.
- Example library package with embedded `doccli.json` + index.
- Changelog entry for `v0.1.0`.

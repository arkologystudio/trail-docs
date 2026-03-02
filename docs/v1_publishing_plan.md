# DocCLI V1 Publishing Plan

## Objective
Ship a stable `v1.0.0` that makes it easier, quicker, and cheaper for agents to use software tools/libraries through a CLI-first docs workflow.

## Product Positioning for V1
- Keep `doc-nav` core local-first, deterministic, and citation-backed.
- Add pre-install library research support as an ingestion layer (`discover` + `fetch`) before existing `build/use` flows.
- Keep external providers optional; do not make any hosted service a hard dependency.

## Current Baseline (already in repo)
- Core commands exist and are tested: `bootstrap`, `build`, `list`, `stats`, `search`, `open`, `cite`, `use`.
- Integration tests pass (`8/8`) and include manifest resolution + bootstrap/use path.
- Structured JSON outputs are documented.

## Prioritized Scope

### P0 (Must ship in V1)
1. External library discovery command.
- Add `doc-nav discover <query>`.
- Resolve candidates from all three source classes:
  - package registries (npm, PyPI, crates.io, etc.),
  - official docs URLs,
  - GitHub repos.
- Return ranked candidates with deterministic JSON fields and confidence.

2. Fetch-and-pin command for pre-install research.
- Add `doc-nav fetch <selector>` where selector can be a discovered candidate, package spec, repo URL, or docs URL.
- Resolve and persist immutable ref:
  - package version + integrity (if available), or
  - commit SHA/tag for git sources.
- Snapshot docs into local cache and produce a local source manifest.

3. Provenance/citation upgrades.
- Extend citation payloads to include external provenance:
  - canonical source URL,
  - resolved immutable ref,
  - fetched timestamp,
  - local snapshot path.
- Ensure `use` steps remain fully citation-backed.

4. Security and safety baseline for untrusted docs.
- Treat fetched content as untrusted by default.
- Add policy controls (allowlist/blocklist, max bytes/files, file types).
- Block active content/scripts during fetch and ingestion.
- Add prompt-injection pattern flags in fetched docs metadata (warning-level signal, not execution).

5. Publish readiness hardening.
- Add missing publish artifacts and metadata:
  - `LICENSE`, `CONTRIBUTING.md`, `CHANGELOG.md`,
  - package metadata (`repository`, `homepage`, `bugs`, `keywords`, `license`, `files`).
- Add CI for tests on Node LTS matrix.
- Add release workflow and npm publish checklist.

### P1 (Should ship if time allows)
1. Cost and speed controls.
- Persistent cache keyed by `source + resolved_ref`.
- Default shallow/sparse fetch strategy focused on docs files.
- Retry/backoff + structured rate-limit errors.

2. Ambiguity handling UX.
- Deterministic top-candidate output from `discover`.
- `--choose <n>` flow for scripted selection.
- Error class for ambiguous matches with top 3 suggestions.

3. One-command happy path.
- Add `doc-nav prep <query_or_url> [--version]`:
  - discover -> fetch -> build -> emit manifest.
- Keeps existing `doc-nav use` experience unchanged after prep.

### P2 (Explicitly out of scope for V1)
- Embeddings/semantic vector search.
- Interactive REPL/shell mode.
- Web UI.
- Multi-doc synthesis as a separate command.
- Non-markdown universal parsers (full HTML/RTF/AsciiDoc support).

## Proposed CLI Additions (V1)
1. `doc-nav discover <query> [--ecosystem <name>] [--max-results <n>] [--json]`
2. `doc-nav fetch <selector> [--version <v>] [--ref <sha|tag>] [--out <dir>] [--json]`
3. `doc-nav prep <query_or_url> [--version <v>] [--path <dir>] [--json]` (P1 but recommended)

## Data Contract Additions
1. Source manifest (`.doc-nav/source.json`)
- `source_type`, `canonical_url`, `requested_ref`, `resolved_ref`, `integrity`, `fetched_at`, `provider`, `trust_signals`.

2. Citation extension
- Keep current citation ID format, add optional provenance object fields in JSON responses.

3. Error contract additions
- `DISCOVERY_FAILED`, `AMBIGUOUS_MATCH`, `FETCH_BLOCKED`, `FETCH_RATE_LIMITED`, `POLICY_VIOLATION`.

## Implementation Sequence (4 Weeks)

### Week 1: Discovery + Contracts
- Implement provider-agnostic discovery interface.
- Add at least two providers:
  - registry metadata provider,
  - GitHub/docs URL resolver.
- Define JSON schemas for discover/fetch outputs and new error codes.
- Add fixture-based tests for deterministic ranking and ambiguity handling.

### Week 2: Fetch + Pinning + Cache
- Implement fetch engine (HTTP/git) with shallow/sparse strategies.
- Persist snapshots and source manifest.
- Add pinning logic and immutable ref resolution.
- Add tests for repeatability and cache hits.

### Week 3: Security + Provenance + Integration
- Add policy file support (`doc-nav.policy.json`) and safe defaults.
- Add injection/suspicious-content flagging metadata.
- Wire provenance through `build`, `cite`, and `use` JSON outputs.
- Add end-to-end test: unknown library -> discover -> fetch -> build -> use.

### Week 4: Publish Hardening
- Add missing repo/legal/release docs and npm package metadata.
- Add CI workflows and release automation.
- Docs updates: quick start for pre-install research workflow.
- Cut `v1.0.0-rc.1`, run smoke tests, then publish `v1.0.0`.

## Acceptance Criteria for V1
1. Agent can go from unknown library name to citation-backed answer without installing the library locally.
2. All externally sourced answers are pinned to immutable refs and include provenance.
3. External source ingestion obeys safety policy defaults and rejects blocked content.
4. Commands remain deterministic in `--json` mode and pass full test suite.
5. Package is publish-ready on npm with legal/docs/release hygiene complete.

## Success Metrics
- Time-to-first-cited-answer for unknown library: <= 60s on warm cache.
- Cache hit rate for repeated queries in same lib/ref: >= 80%.
- Citation coverage for `use` steps: 100%.
- Publish quality gate: CI green + reproducible release checklist complete.

## Open Decisions to Resolve Early
1. Which registries are first-class in V1 (minimum set)?
2. Default trust policy thresholds (strict vs permissive)?
3. Whether `prep` is included in V1 or delayed to V1.1?
4. Citation format evolution: inline provenance vs sidecar object only?

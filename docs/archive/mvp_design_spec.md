# DocCLI MVP Design Spec

## 1. Objective

Ship a local-first CLI that lets agents and developers query versioned documentation with deterministic, compact, machine-readable outputs.

## 2. MVP Scope

### In scope
- Markdown ingestion.
- Single local index artifact (`.doccli/index.json`).
- Library manifest (`doccli.json`) for discovery.
- Commands: `bootstrap`, `build`, `search`, `open`, `cite`, `use`.
- Human output plus deterministic `--json`.

### Out of scope (v1)
- Hosted infra, auth, or remote APIs.
- Vector DB / embedding search.
- Deep semantic code analysis.
- Multi-format ingestion beyond Markdown.

## 3. Packaging and Discovery

Libraries ship:
- `doccli.json` at package root.
- `.doccli/index.json` path referenced by `doccli.json`.

`doccli.json` schema:

```json
{
  "schema_version": "1",
  "library": "acme-payments",
  "library_version": "2.4.1",
  "index_path": ".doccli/index.json",
  "built_at": "2026-02-24T00:00:00Z"
}
```

Resolution order for `doccli use <library> ...`:
1. Explicit `--path`.
2. Environment override `DOCCLI_PATHS`.
3. Runtime package lookup (language-specific, starting with Node `node_modules`).

## 4. Command Contract

### Global flags
- `--json`: strict machine-readable output.
- `--no-color`: disable ANSI.
- `--max-chars <n>`: bound long content payloads.
- `--max-results <n>`: bound result sets.

### `doccli bootstrap`
Purpose: generate starter docs from code when no docs exist, then build index.

Input:
- `--src <dir>` required.
- `--library <name>` required.
- `--version <semver>` required.
- `--docs-out <dir>` default `.doccli/generated-docs`.
- `--out <file>` default `.doccli/index.json`.
- `--emit-manifest` optional, writes `doccli.json`.
- `--manifest-out <file>` default `doccli.json`.

Behavior:
- Scan source files (`.js`, `.ts`, `.py`, `.go`, `.rs`) for exported symbols, routes, and env vars.
- Generate markdown docs with clear "partial confidence" labeling.
- Build index from generated markdown.
- Optionally emit a consumable manifest for `doccli use`.

### `doccli build`
Purpose: create deterministic index from Markdown docs.

Input:
- `--src <dir>` required.
- `--out <file>` default `.doccli/index.json`.
- `--library <name>` required.
- `--version <semver>` required.

Behavior:
- Parse markdown files.
- Extract headings, anchors, section text, fenced code blocks.
- Compute source hash and stable IDs.
- Write single JSON index.

### `doccli search <query>`
Purpose: lexical retrieval of relevant sections.

Output item fields:
- `score` number.
- `doc_id` string.
- `anchor` string.
- `heading` string.
- `snippet` string (bounded).
- `source_path` string.
- `version` string.

Sorting:
- Descending `score`.
- Tie-breaker: `doc_id`, then `anchor` (lexicographic).

### `doccli open <doc_id#anchor>`
Purpose: retrieve canonical section content.

Output fields:
- `doc_id`, `anchor`, `heading`.
- `content` (bounded by `--max-chars`).
- `code_blocks` array.
- `source_path`, `line_start`, `line_end`, `version`.

### `doccli cite <doc_id#anchor>`
Purpose: return citation metadata for provenance.

Output fields:
- `citation_id` stable string.
- `library`, `version`.
- `doc_id`, `anchor`.
- `source_path`, `line_start`, `line_end`.

### `doccli use <library> "<task>"`
Purpose: task-oriented orchestrator over `search/open/cite`.

Output fields:
- `task` input string.
- `library`, `version`.
- `steps[]` ordered actionable items.
- `snippet` minimal runnable example when available.
- `citations[]` one or more citations backing every step.
- `confidence` enum: `authoritative` or `partial`.

`use` must not invent facts not present in index sections.

## 5. Index Schema (MVP)

```json
{
  "schema_version": "1",
  "library": "acme-payments",
  "version": "2.4.1",
  "build": {
    "tool_version": "0.1.0",
    "built_at": "2026-02-24T00:00:00Z",
    "source_hash": "sha256:..."
  },
  "docs": [
    {
      "doc_id": "auth/oauth",
      "title": "OAuth",
      "source_path": "docs/auth/oauth.md"
    }
  ],
  "sections": [
    {
      "section_id": "sec_...",
      "doc_id": "auth/oauth",
      "anchor": "refresh",
      "heading": "Refresh Token",
      "line_start": 42,
      "line_end": 96,
      "text": "...",
      "snippet": "...",
      "code_blocks": ["curl ..."]
    }
  ]
}
```

## 6. Determinism Rules

- Stable file traversal (path-ascending).
- Stable anchor normalization.
- Stable section IDs from content hash + doc path + anchor.
- Explicit tie-break sort for all list outputs.
- `--json` key order fixed by struct serialization (no map iteration).

## 7. Exit Codes and Errors

- `0`: success.
- `2`: invalid CLI arguments.
- `3`: manifest not found / resolution failure.
- `4`: index missing or unreadable.
- `5`: target reference not found.
- `6`: index schema mismatch.
- `7`: internal processing error.

Error JSON format:

```json
{
  "error": {
    "code": "DOC_NOT_FOUND",
    "message": "No section found for auth/oauth#refresh-old",
    "hint": "Run doccli search \"refresh token\""
  }
}
```

## 8. Acceptance Criteria

- Build index for sample docs with reproducible hash.
- Same query returns same ordered results across repeated runs.
- `open` and `cite` always include provenance fields.
- `use` returns step list where each step has at least one citation.
- All command errors emit deterministic machine-readable JSON with exit codes.

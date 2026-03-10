# Trail Docs JSON Output Schema (v2)

This document defines JSON payloads emitted by `trail-docs` when `--json` is used.

## Error Envelope

```json
{
  "error": {
    "code": "INVALID_ARGS",
    "message": "Human-readable error",
    "hint": "Optional recovery hint"
  }
}
```

## Common Navigation Envelope

Commands: `find`, `search`, `expand`, `extract`

```json
{
  "library": "string",
  "version": "string",
  "query": "string",
  "items": [
    {
      "ref": "doc_id#anchor",
      "unit_id": "unit_xxx",
      "type": "fact|step|command|constraint|definition",
      "text": "string",
      "citation_id": "library@version:doc#anchor:start-end",
      "token_estimate": 0,
      "source_path": "string",
      "line_start": 0,
      "line_end": 0,
      "confidence_lexical": 0,
      "why_matched": ["token:auth", "heading:oauth"],
      "score": 0,
      "score_components": {
        "lexical": 0,
        "heading_boost": 0,
        "symbol_boost": 0,
        "command_boost": 0,
        "novelty_penalty": 0,
        "token_cost_penalty": 0
      }
    }
  ],
  "budget_tokens": 0,
  "spent_tokens": 0,
  "remaining_tokens": 0
}
```

## `find` / `search`

`search` is an alias of `find` and returns compact start points:

```json
{
  "library": "string",
  "version": "string",
  "query": "string",
  "items": [
    {
      "ref": "doc_id#anchor",
      "est_tokens": 0,
      "why_matched": ["token:refresh"],
      "top_units": [
        {
          "ref": "doc_id#anchor",
          "unit_id": "unit_xxx",
          "type": "step",
          "text": "string",
          "citation_id": "string",
          "token_estimate": 0,
          "source_path": "string",
          "line_start": 0,
          "line_end": 0,
          "confidence_lexical": 0,
          "why_matched": ["token:refresh"],
          "score": 0,
          "score_components": {}
        }
      ]
    }
  ],
  "budget_tokens": 0,
  "spent_tokens": 0,
  "remaining_tokens": 0
}
```

## `expand`

Expands a single anchor (`ref`) under a hard budget:

```json
{
  "library": "string",
  "version": "string",
  "query": "",
  "ref": "doc_id#anchor",
  "items": ["...unit items..."],
  "budget_tokens": 0,
  "spent_tokens": 0,
  "remaining_tokens": 0
}
```

## `extract`

Query-conditioned extraction from explicit refs (`--from`):

```json
{
  "library": "string",
  "version": "string",
  "query": "string",
  "refs": ["doc#anchor", "doc#anchor"],
  "items": ["...unit items..."],
  "budget_tokens": 0,
  "spent_tokens": 0,
  "remaining_tokens": 0
}
```

## `neighbors`

```json
{
  "library": "string",
  "version": "string",
  "ref": "doc_id#anchor",
  "items": [
    {
      "ref": "doc_id#anchor",
      "edge_type": "heading_adjacent|intra_doc_link|keyword_overlap|symbol_overlap"
    }
  ],
  "budget_tokens": 0,
  "spent_tokens": 0,
  "remaining_tokens": 0
}
```

## `open`

### `open --mode units` (default)

```json
{
  "library": "string",
  "version": "string",
  "mode": "units",
  "ref": "doc_id#anchor",
  "items": ["...unit items..."],
  "budget_tokens": 0,
  "spent_tokens": 0,
  "remaining_tokens": 0
}
```

### `open --mode section`

```json
{
  "library": "string",
  "version": "string",
  "mode": "section",
  "ref": "doc_id#anchor",
  "doc_id": "string",
  "anchor": "string",
  "heading": "string",
  "content": "string",
  "code_blocks": ["string"],
  "source_path": "string",
  "line_start": 0,
  "line_end": 0
}
```

## `trail`

State model persisted in `.trail-docs/trails/<trail_id>.json`.

```json
{
  "trail_id": "trail_xxx",
  "objective": "string",
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "visited_refs": ["doc#anchor"],
  "pinned_evidence": ["library@version:doc#anchor:start-end"],
  "coverage_tags": ["string"]
}
```

## `build`

```json
{
  "ok": true,
  "library": "string",
  "version": "string",
  "index_path": "string",
  "docs_count": 0,
  "sections_count": 0,
  "source_hash": "sha256:...",
  "source_manifest_path": "optional absolute path"
}
```

## `stats`

```json
{
  "schema_version": "2",
  "library": "string",
  "version": "string",
  "docs_count": 0,
  "sections_count": 0,
  "evidence_units_count": 0,
  "anchors_count": 0,
  "code_blocks_count": 0,
  "sections_per_doc": 0,
  "built_at": "ISO-8601",
  "source_hash": "sha256:..."
}
```

## `cite`

```json
{
  "citation_id": "library@version:doc_id#anchor:start-end",
  "library": "string",
  "version": "string",
  "doc_id": "string",
  "anchor": "string",
  "source_path": "string",
  "line_start": 0,
  "line_end": 0
}
```

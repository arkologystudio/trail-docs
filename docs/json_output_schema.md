# DocCLI JSON Output Schema (v0.1.x)

This document defines the JSON shape for each `doccli` command when `--json` is used.

## Error Envelope

All commands can return this payload on failure:

```json
{
  "error": {
    "code": "INVALID_ARGS",
    "message": "Human-readable error",
    "hint": "Optional recovery hint"
  }
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
  "source_hash": "sha256:..."
}
```

## `bootstrap`

```json
{
  "ok": true,
  "confidence": "partial",
  "generated_docs_dir": "string",
  "generated_docs_file": "string",
  "source_files_scanned": 0,
  "symbols_detected": 0,
  "routes_detected": 0,
  "env_vars_detected": 0,
  "index_path": "string",
  "manifest_path": "string",
  "docs_count": 0,
  "sections_count": 0,
  "source_hash": "sha256:..."
}
```

## `list`

```json
{
  "library": "string",
  "version": "string",
  "docs": [
    {
      "doc_id": "string",
      "title": "string",
      "source_path": "string",
      "sections": 0
    }
  ]
}
```

## `stats`

```json
{
  "library": "string",
  "version": "string",
  "docs_count": 0,
  "sections_count": 0,
  "code_blocks_count": 0,
  "sections_per_doc": 0,
  "built_at": "ISO-8601 timestamp",
  "source_hash": "sha256:..."
}
```

## `search`

```json
{
  "query": "string",
  "library": "string",
  "version": "string",
  "results": [
    {
      "score": 0,
      "doc_id": "string",
      "anchor": "string",
      "heading": "string",
      "snippet": "string",
      "source_path": "string",
      "line_start": 0,
      "line_end": 0
    }
  ]
}
```

## `open`

```json
{
  "library": "string",
  "version": "string",
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

## `use`

```json
{
  "task": "string",
  "library": "string",
  "version": "string",
  "confidence": "authoritative|partial",
  "steps": [
    {
      "id": "step_1",
      "instruction": "string",
      "confidence": 0,
      "command": "optional string",
      "prerequisites": "optional string",
      "expected": "optional string",
      "citations": ["citation_id"]
    }
  ],
  "snippet": "string",
  "citations": ["citation_id"],
  "related_docs": ["doc_id"]
}
```

Notes:
- Optional fields may be omitted when no signal is available.
- Numeric scores are relative relevance/confidence and not calibrated probabilities.

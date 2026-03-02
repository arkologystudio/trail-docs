# DocCLI JSON Output Schema (v0.1.x)

This document defines the JSON shape for each `trail-docs` command when `--json` is used.

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
  "source_hash": "sha256:...",
  "source_manifest_path": "optional absolute path"
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
  "signals_detected": 0,
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
  "source_hash": "sha256:...",
  "inferred": false,
  "derivation": "optional string",
  "source": {
    "source_type": "string",
    "provider": "string",
    "canonical_url": "string",
    "requested_ref": "string",
    "resolved_ref": "string",
    "integrity": "string",
    "fetched_at": "ISO-8601 timestamp",
    "snapshot_dir": "string",
    "docs_dir": "string",
    "trust_signals": {}
  }
}
```

## `discover`

```json
{
  "query": "string",
  "provider": "all|catalog|npm|github",
  "ecosystem": "string",
  "candidates": [
    {
      "name": "string",
      "selector": "string",
      "source_type": "registry|github|docs|catalog",
      "ecosystem": "string",
      "canonical_url": "string",
      "description": "string",
      "versions": ["string"],
      "trust_score": 0,
      "benchmark_score": 0,
      "confidence": 0
    }
  ]
}
```

## `fetch`

```json
{
  "ok": true,
  "selector": "string",
  "library": "string",
  "version": "string",
  "source_type": "registry|github|docs|local",
  "canonical_url": "string",
  "requested_ref": "string",
  "resolved_ref": "string",
  "integrity": "string",
  "snapshot_dir": "string",
  "docs_dir": "string",
  "source_manifest_path": "string",
  "files_copied": 0,
  "total_bytes": 0,
  "trust_signals": {
    "suspicious_count": 0,
    "suspicious_files": [
      {
        "path": "string",
        "patterns": ["regex-source"]
      }
    ]
  },
  "cache_hit": false
}
```

## `prep` / `index`

```json
{
  "ok": true,
  "query": "string",
  "selector": "string",
  "library": "string",
  "version": "string",
  "index_path": "string",
  "manifest_path": "string",
  "source_manifest_path": "string",
  "docs_dir": "string",
  "source": {
    "source_type": "string",
    "canonical_url": "string",
    "resolved_ref": "string"
  },
  "discovered": {
    "query": "string",
    "candidates": []
  }
}
```

## `surface`

```json
{
  "ok": true,
  "selector": "string",
  "library": "string",
  "version": "string",
  "confidence": "authoritative|partial",
  "source": {
    "source_type": "local|registry|github|docs",
    "provider": "local|npm|github|url",
    "canonical_url": "string",
    "resolved_ref": "string",
    "snapshot_dir": "optional string"
  },
  "exports": [
    {
      "export_name": "string",
      "kind": "function|class|method|type",
      "symbol_id": "string"
    }
  ],
  "symbols": [
    {
      "symbol_id": "string",
      "name": "string",
      "fq_name": "string",
      "kind": "function|class|method|type",
      "signatures": ["string"],
      "summary": "string",
      "module_path": "string",
      "line_start": 0,
      "line_end": 0,
      "examples": [
        {
          "code": "string",
          "source_path": "string",
          "line_start": 0,
          "line_end": 0
        }
      ]
    }
  ],
  "stats": {
    "modules_scanned": 0,
    "symbols_extracted": 0,
    "bytes_scanned": 0
  },
  "cache_hit": false
}
```

## `fn`

```json
{
  "selector": "string",
  "symbol_query": "string",
  "match_type": "exact|prefix|fuzzy",
  "symbol": {
    "symbol_id": "string",
    "fq_name": "string",
    "kind": "function|class|method|type",
    "signatures": ["string"],
    "summary": "string"
  },
  "citations": ["string"],
  "citation_details": [
    {
      "citation_id": "string",
      "source_path": "string",
      "line_start": 0,
      "line_end": 0,
      "provenance": {}
    }
  ],
  "examples": [
    {
      "code": "string",
      "source_path": "string",
      "line_start": 0,
      "line_end": 0
    }
  ]
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

### `search` federated mode (`--indexes`)

```json
{
  "query": "string",
  "mode": "federated",
  "indexes": ["string"],
  "results": [
    {
      "score": 0,
      "library": "string",
      "version": "string",
      "doc_id": "string",
      "anchor": "string",
      "citation_id": "string"
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
  "line_end": 0,
  "provenance": {
    "source_type": "string",
    "provider": "string",
    "canonical_url": "string",
    "requested_ref": "string",
    "resolved_ref": "string",
    "fetched_at": "ISO-8601 timestamp"
  }
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
  "citation_details": [
    {
      "citation_id": "string",
      "provenance": {}
    }
  ],
  "related_docs": ["doc_id"]
}
```

## `use` (multi-library mode)

```json
{
  "task": "string",
  "mode": "multi_library",
  "recommendations": [
    {
      "rank": 1,
      "selector": "string",
      "library": "string",
      "symbol_id": "string",
      "fq_name": "string",
      "signature": "string",
      "confidence": 0,
      "why": "string",
      "citation_id": "string"
    }
  ],
  "alternatives": [],
  "considered_libraries": ["string"]
}
```

## `use` (federated docs mode)

```json
{
  "task": "string",
  "mode": "federated_docs",
  "confidence": "authoritative|partial",
  "indexes": ["string"],
  "steps": [
    {
      "id": "step_1",
      "library": "string",
      "version": "string",
      "instruction": "string",
      "confidence": 0,
      "citations": ["citation_id"]
    }
  ],
  "citations": ["citation_id"]
}
```

Notes:
- Optional fields may be omitted when no signal is available.
- Numeric scores are relative relevance/confidence and not calibrated probabilities.
- When an index is bootstrap-derived (`build.inferred=true`), `use` returns overall `"confidence": "partial"` even when step-level scores are present.

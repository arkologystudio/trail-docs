# DocCLI MVP JSON Contract Examples

## `build` success

```json
{
  "ok": true,
  "library": "acme-payments",
  "version": "2.4.1",
  "index_path": ".doccli/index.json",
  "docs_count": 12,
  "sections_count": 148,
  "source_hash": "sha256:5f1f2d..."
}
```

## `bootstrap` success

```json
{
  "ok": true,
  "confidence": "partial",
  "generated_docs_dir": "/repo/.doccli/generated-docs",
  "generated_docs_file": "/repo/.doccli/generated-docs/bootstrap.md",
  "source_files_scanned": 24,
  "symbols_detected": 81,
  "routes_detected": 9,
  "env_vars_detected": 5,
  "index_path": ".doccli/index.json",
  "manifest_path": "/repo/doccli.json",
  "docs_count": 1,
  "sections_count": 14,
  "source_hash": "sha256:91ad..."
}
```

## `search` success

```json
{
  "query": "webhook signature",
  "library": "acme-payments",
  "version": "2.4.1",
  "results": [
    {
      "score": 0.8123,
      "doc_id": "webhooks/verify",
      "anchor": "signature-validation",
      "heading": "Validate Signatures",
      "snippet": "Use the X-Acme-Signature header and your endpoint secret...",
      "source_path": "docs/webhooks/verify.md",
      "line_start": 10,
      "line_end": 42
    }
  ]
}
```

## `open` success

```json
{
  "library": "acme-payments",
  "version": "2.4.1",
  "doc_id": "webhooks/verify",
  "anchor": "signature-validation",
  "heading": "Validate Signatures",
  "content": "To verify incoming webhooks, compute an HMAC-SHA256...",
  "code_blocks": [
    "const expected = hmacSha256(secret, payload);"
  ],
  "source_path": "docs/webhooks/verify.md",
  "line_start": 10,
  "line_end": 42
}
```

## `cite` success

```json
{
  "citation_id": "acme-payments@2.4.1:webhooks/verify#signature-validation:10-42",
  "library": "acme-payments",
  "version": "2.4.1",
  "doc_id": "webhooks/verify",
  "anchor": "signature-validation",
  "source_path": "docs/webhooks/verify.md",
  "line_start": 10,
  "line_end": 42
}
```

## `use` success

```json
{
  "task": "set up webhook signature verification",
  "library": "acme-payments",
  "version": "2.4.1",
  "confidence": "authoritative",
  "steps": [
    {
      "id": "step_1",
      "instruction": "Read the raw request body before JSON parsing.",
      "citations": [
        "acme-payments@2.4.1:webhooks/verify#signature-validation:10-42"
      ]
    },
    {
      "id": "step_2",
      "instruction": "Compute HMAC-SHA256 using your endpoint secret and compare it to X-Acme-Signature.",
      "citations": [
        "acme-payments@2.4.1:webhooks/verify#signature-validation:10-42"
      ]
    }
  ],
  "snippet": "const expected = hmacSha256(secret, rawBody);"
}
```

## Error format

```json
{
  "error": {
    "code": "INDEX_NOT_FOUND",
    "message": "Could not find .doccli/index.json for library acme-payments",
    "hint": "Install docs artifact or pass --path"
  }
}
```

## Error codes

```json
{
  "INVALID_ARGS": 2,
  "RESOLUTION_FAILED": 3,
  "INDEX_UNREADABLE": 4,
  "REF_NOT_FOUND": 5,
  "SCHEMA_MISMATCH": 6,
  "INTERNAL_ERROR": 7
}
```

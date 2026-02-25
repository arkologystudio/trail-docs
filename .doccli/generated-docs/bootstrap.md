# acme-runtime Bootstrap Docs

This documentation is generated from source code.
Confidence: partial (derived/inferred).

## Summary

- Source files scanned: 1
- Symbols detected: 3
- Routes detected: 1
- Environment vars detected: 2

## Environment Variables

- `ACME_API_KEY`
- `ACME_WEBHOOK_SECRET`

## Routes

- POST /webhooks/events

## Symbols

### ../../../../../../var/folders/ny/1mcvd5310m93pbz5n5b7lj3m0000gn/T/tmp.OnDO4dal4u/project/src/server.ts

Functions and classes:

- function: `verifySignature(rawBody: string, signature: string, secret: string)` (line 1)
- function: `startServer(port: number)` (line 14)
- class: `WebhookClient` (line 6)

Routes:

- POST /webhooks/events

Environment variables:

- `ACME_API_KEY`
- `ACME_WEBHOOK_SECRET`

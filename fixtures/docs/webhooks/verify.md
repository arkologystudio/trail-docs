# Webhooks

## Signature Validation

Read the raw request body before JSON parsing.
Compute HMAC-SHA256 using your endpoint secret and compare with `X-Acme-Signature`.

```js
const expected = hmacSha256(secret, rawBody);
```

Reject the request if the signature does not match.

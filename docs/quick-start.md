# Quick Start (v2)

Get `trail-docs` running as a navigation-first docs tool in minutes.

## 1) Install

```bash
npm install -g trail-docs
trail-docs --help
```

## 2) Build an index

```bash
trail-docs build \
  --src . \
  --library "MyProject" \
  --version "1.0.0" \
  --out .trail-docs/index.json
```

## 3) Navigate evidence (agent-first workflow)

```bash
# hop 1: find high-signal start points
trail-docs find "refresh token flow" --index .trail-docs/index.json --json

# hop 2: expand one anchor under strict budget
trail-docs expand "auth/oauth#refresh-token" --index .trail-docs/index.json --budget 300 --json

# hop 2b: traverse graph neighbors
trail-docs neighbors "auth/oauth#refresh-token" --index .trail-docs/index.json --json

# hop 3: extract query-conditioned evidence from chosen refs
trail-docs extract "refresh token flow" \
  --from "auth/oauth#refresh-token,webhooks/verify#signature-validation" \
  --index .trail-docs/index.json \
  --budget 500 \
  --json
```

## 4) Open section or units

```bash
# default open mode is units
trail-docs open "auth/oauth#refresh-token" --index .trail-docs/index.json --json

# section mode
trail-docs open "auth/oauth#refresh-token" --mode section --index .trail-docs/index.json --json
```

## 5) Manage explicit trail state

```bash
trail-docs trail create --objective "map auth coverage" --json
trail-docs trail add --trail trail_xxxxx --ref "auth/oauth#refresh-token" --index .trail-docs/index.json --json
trail-docs trail pin --trail trail_xxxxx --citation "MyProject@1.0.0:auth/oauth#refresh-token:10-20" --json
trail-docs trail tag --trail trail_xxxxx --tag "coverage:auth" --json
trail-docs trail show --trail trail_xxxxx --json
```

## Notes

- `search` is an alias for `find`.
- `use` was removed in v2.
- Budgeted commands always return `budget_tokens`, `spent_tokens`, and `remaining_tokens`.

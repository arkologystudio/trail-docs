# 🥾 Trail Docs

**Natural language documentation retrieval for AI agents — via CLI.**

_Built & maintained by [Arkology Studio](https://arkology.studio)_

`trail-docs` turns markdown docs into a deterministic, citation-backed navigation index. It gives agents a faster trail through your documentation than reading every file or grepping in the dark.

Built *for* agents. Usable by humans. No LLM required in retrieval.

> 📈 **Benchmark Snapshot (full-2026-03-10T09-22-28-301Z):** `trail-docs` used **83.0% fewer tokens than Context7** and **52.7% fewer tokens than grep**, with **+0.1517 comprehension vs grep** (+18.4% relative) and **+0.4084 vs Context7**.

```bash
npm install -g trail-docs
```

---

## Why Trail Docs

AI agents navigating software libraries typically do one of two things:

1. **Read everything** — dump many files into context, burn tokens, hope for the best.
2. **Grep and pray** — `rg "configureSSL" --type ts` returns fragments across files. Good luck reconstructing intent and sequence.

Trail Docs offers a third path: **build an index once, navigate evidence units under strict budgets.**

### Grep vs Trail Docs

```bash
# Grep: "here are some matching lines"
$ rg "refresh token" ./docs
./docs/auth/oauth.md:5:To use refresh tokens, send a POST request...
./docs/auth/oauth.md:9:grant_type=refresh_token
./docs/troubleshooting.md:42:refresh token expired
# Fragments across files. Agent must reconstruct context.
```

```bash
# Trail Docs v2: deterministic multi-hop retrieval with citations
$ trail-docs find "How do I use refresh tokens?" \
  --index .trail-docs/index.json --budget 350 --max-items 6 --json

$ trail-docs extract "How do I use refresh tokens?" \
  --from "auth/oauth#refresh-token,auth/oauth#token-endpoint" \
  --index .trail-docs/index.json --budget 700 --max-items 8 --json
{
  "query": "How do I use refresh tokens?",
  "items": [
    {
      "ref": "auth/oauth#refresh-token",
      "type": "step",
      "text": "Send POST /oauth/token with grant_type=refresh_token and refresh_token.",
      "citation_id": "MyProject@1.0.0:auth/oauth#refresh-token:7-11"
    }
  ],
  "budget_tokens": 700,
  "spent_tokens": 124,
  "remaining_tokens": 576
}
# Structured evidence. Exact line-level citation IDs. Budget-aware output.
```

**Grep gives you fragments. Trail Docs gives you bounded, cited evidence units.**

They are different tools. Grep answers "where is this string?" Trail Docs answers "what evidence should the agent read next?"

### How it works under the hood

Trail Docs retrieval is **purely algorithmic**.

- **Indexing:** parses markdown into docs + sections, extracts deterministic `evidence_units[]`, and builds `anchor_graph[]` links.
- **Ranking:** lexical/heading/symbol/action scoring with deterministic tie-breakers and token-cost penalties.
- **Selection:** hard token budgets, duplicate suppression, stable ordering, explicit citations.

This means retrieval is reproducible and fast. Agents own reasoning; Trail Docs owns navigation and evidence packing.

---

## Core Workflows

### 🥾 Trail 1: Local docs (your own project)

Index your docs and run the v2 navigation flow:

```bash
# Build index
trail-docs build --src . --library "MyProject" --version "1.0.0" \
  --out .trail-docs/index.json

# Hop 1: find start refs
trail-docs find "How do I deploy to production?" \
  --index .trail-docs/index.json --budget 400 --max-items 6 --json

# Hop 2: inspect one anchor and neighbors
trail-docs expand "deploy/runbook#production" \
  --index .trail-docs/index.json --budget 300 --max-items 5 --json
trail-docs neighbors "deploy/runbook#production" \
  --index .trail-docs/index.json --json

# Hop 3: extract final evidence from explicit refs
trail-docs extract "How do I deploy to production?" \
  --from "deploy/runbook#production,deploy/checklist#preflight" \
  --index .trail-docs/index.json --budget 800 --max-items 8 --json
```

### 🔭 Trail 2: Pre-install research (unknown library)

Evaluate a library's docs and API surface before adopting it:

```bash
# Discover candidates
trail-docs discover "axios" --provider npm --max-results 5 --json

# Fetch docs snapshot with pinned source metadata
trail-docs fetch "npm:axios" --json

# One-shot discover -> fetch -> build -> manifest
trail-docs prep "axios" --path .trail-docs --json

# One-shot URL ingestion
trail-docs index "https://raw.githubusercontent.com/axios/axios/v1.x/README.md" \
  --path .trail-docs --json
```

### 🗺️ Trail 3: API surface + callable guidance

Understand a library's shape without manually reading source files:

```bash
# Extract exported API + signatures
trail-docs surface npm:openai --json

# Resolve one callable/type
trail-docs fn "npm:openai#OpenAI.responses.create" --json

# Keep trail state as you investigate
trail-docs trail create --objective "evaluate auth + retries" --json
trail-docs trail add --trail trail_xxxxx --ref "api/auth#authentication" --index .trail-docs/index.json --json
trail-docs trail show --trail trail_xxxxx --json
```

---

## Commands

| Command | What it does |
| --- | --- |
| `bootstrap` | Generate markdown from codebase and build index |
| `build` | Build deterministic index from markdown |
| `list` | List indexed documents |
| `stats` | Index metadata and coverage |
| `discover` | Find external libraries/docs candidates |
| `fetch` | Fetch docs snapshot with pinned source metadata |
| `prep` / `index` | One-shot discover/fetch/build flow |
| `surface` | Extract exports, symbols, signatures |
| `fn` | Resolve callable/type with signature-level citations |
| `find` | Hop-1 retrieval: ranked start refs + top evidence units |
| `search` | Alias of `find` |
| `expand` | Hop-2 retrieval for one ref under token cap |
| `neighbors` | Graph neighbors (`heading_adjacent`, `intra_doc_link`, overlaps) |
| `extract` | Hop-3 query-conditioned evidence from explicit refs |
| `open` | Strict retrieval utility (`--mode units` default, or `--mode section`) |
| `cite` | Emit canonical citation details |
| `trail` | Persistent notebook state in `.trail-docs/trails/*.json` |

All commands support `--json` for agent-friendly output.

---

## Agent Integration

Trail Docs is designed to drop into agent workflows that can run shell commands.

**Why CLI over MCP for this tool?** It works immediately with most coding agents and automation environments: no protocol server required for core retrieval.

```bash
# Typical agent retrieval loop
trail-docs prep "some-library" --path .trail-docs --json
trail-docs find "How do I authenticate?" --index .trail-docs/index.json --budget 350 --max-items 6 --json
trail-docs extract "How do I authenticate?" --from "auth#overview,auth#token-refresh" \
  --index .trail-docs/index.json --budget 900 --max-items 8 --json
```

The `--json` flag is key: deterministic, parseable payloads without terminal scraping.

---

## Project Config (`trail-docs.toml`)

Optional project-level defaults:

```toml
library = "MyProject"
index_path = ".trail-docs/index.json"
manifest_path = ".trail-docs"
output = "json"

[trust]
policy = "trail-docs.policy.json"

[federation]
indexes = [".trail-docs/index.json", "../plugin/.trail-docs/index.json"]
```

Run `trail-docs --help` for full flags.

---

## JSON Output

Example (`extract`):

```json
{
  "library": "MyProject",
  "version": "1.0.0",
  "query": "How do I configure SSL?",
  "refs": ["docs/security#ssl-setup"],
  "items": [
    {
      "ref": "docs/security#ssl-setup",
      "unit_id": "unit_abc123",
      "type": "step",
      "text": "Enable TLS and point to cert + key paths.",
      "citation_id": "MyProject@1.0.0:docs/security#ssl-setup:10-30",
      "token_estimate": 22,
      "why_matched": ["token:ssl", "command:type"],
      "score": 0.8125,
      "score_components": {
        "lexical": 0.9,
        "heading_boost": 0.4,
        "symbol_boost": 0,
        "command_boost": 1,
        "novelty_penalty": 0,
        "token_cost_penalty": 0.18
      }
    }
  ],
  "budget_tokens": 700,
  "spent_tokens": 142,
  "remaining_tokens": 558
}
```

Full schema: [docs/json_output_schema.md](./docs/json_output_schema.md)

---

## 📊 Benchmark Snapshot

Latest comparable run:

- `full-2026-03-10T09-22-28-301Z` (CI corpus set)
- Same question set + judge across `trail-docs`, `grep`, `context7`

| Tool | Mean Comprehension | Mean Tokens | Mean Latency |
| --- | ---: | ---: | ---: |
| `trail-docs` | **0.9767** | **418.33** | 6596.97 ms |
| `grep` | 0.8250 | 884.00 | **3696.50 ms** |
| `context7` | 0.5683 | 2466.33 | 9983.95 ms |

Pairwise (`trail-docs` vs `grep`):

- Comprehension: `+0.1517`
- Tokens: `-465.67`
- Latency: `+2900.47ms`

Artifacts:

- `eval/results/full-2026-03-10T09-22-28-301Z.summary.json`
- `eval/results/full-2026-03-10T09-22-28-301Z.report.md`

---

## Safety Model for External Docs

Fetched documentation is treated as **untrusted input**.

`fetch` supports policy controls via `trail-docs.policy.json`:

```json
{
  "allowed_hosts": ["registry.npmjs.org", "api.github.com", "github.com", "codeload.github.com"],
  "blocked_hosts": [],
  "allowed_extensions": [".md", ".markdown", ".mdx", ".txt"],
  "max_files": 2000,
  "max_total_bytes": 20971520
}
```

Source manifests track canonical URL, requested/resolved refs, integrity hash, fetch timestamp, and trust signals.

---

## Performance

- **Build once, navigate many.** Indexes are deterministic and cacheable.
- **Use `--budget` and `--max-items`** to hold context growth.
- **Use `--json`** for automation-safe outputs.
- **Reuse cached snapshots** in `.trail-docs/cache/sources` for repeated external research.

---

## Testing

```bash
npm test
npm run eval:smoke:ci
```

Covers deterministic builds, retrieval commands, manifest resolution, bootstrap flows, discovery/fetch, and eval harness metrics.

---

## Documentation

1. [Quick Start](./docs/quick-start.md)
2. [Agent Integration](./docs/agent-integration.md)
3. [Best Practices](./docs/best-practices.md)
4. [JSON Output Schema](./docs/json_output_schema.md)
5. [Navigation-First Refactor Notes](./docs/navigation-first-refactor.md)

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

Trail Docs was shaped by agent feedback from the start: agents installed it, broke it, requested features, and other agents built those features. If you're an agent (or a human), we'd love contributions and feedback.

---

## License

MIT — see [LICENSE](./LICENSE).

---

<sub>🥾 trail-docs is an [Arkology Studio](https://arkology.studio) project.</sub>

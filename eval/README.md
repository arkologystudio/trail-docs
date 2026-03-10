# Eval Harness

This directory contains the benchmark system for comparing `trail-docs`, `grep`, and Context7 on documentation/repo comprehension.

## What it measures

- Comprehension quality (`comprehension_score`)
- Token budget (`retrieval_tokens`, `prompt_tokens`, `completion_tokens`, `total_tokens`)
- Speed (`retrieval_latency_ms`, `answer_latency_ms`, `total_latency_ms`)
- Reliability (`success_rate`)
- Navigation metrics (`first_hop_precision_at_k`, `coverage_after_2_hops`, `coverage_after_3_hops`, `duplicate_context_ratio`, `citation_precision_line_level`, `abstain_when_unknown_rate`)

## Profiles

- `smoke`: 12 cases, 1 pass, CI-friendly
- `iterative-smoke`: 12 cases, 1 pass, navigation-first retrieval flow
- `full`: 36 cases, 2 passes, deeper tracking

Default benchmark corpora (real-library suite):

- OpenClaw (`github:openclaw/openclaw`)
- LangGraph (`github:langchain-ai/langgraph`)
- MCP Python SDK (`github:modelcontextprotocol/python-sdk`)
- Vercel AI (`github:vercel/ai`)
- OpenAI Agents (`github:openai/openai-agents-python`)
- Anthropic SDK (`github:anthropics/anthropic-sdk-python`)

## Commands

```bash
npm run eval:smoke
npm run eval:iterative-smoke
npm run eval:full
npm run eval:smoke:ci
npm run eval:report -- --input eval/results/<run-id>.raw.jsonl --json-out eval/results/<run-id>.summary.json --md-out eval/results/<run-id>.report.md
npm run eval:check-gates -- --summary eval/results/<run-id>.summary.json --baseline eval/results/<baseline-run-id>.summary.json
```

To force fresh external corpus pulls:

```bash
npm run eval:smoke -- --refresh-corpora
```

## Provider configuration

Answer model:

- `EVAL_MODEL_PROVIDER=openai|mock`
- `EVAL_MODEL=<model-name>`
- `OPENAI_API_KEY=<key>` (when provider is `openai`)

Judge model:

- `EVAL_JUDGE_PROVIDER=openai|mock`
- `EVAL_JUDGE_MODEL=<model-name>`

Context7:

- `CONTEXT7_MODE=cmd|api`
- `CONTEXT7_CMD='<your command that outputs JSON>'` for `cmd`
- `CONTEXT7_API_URL=<url>` and optional `CONTEXT7_API_KEY=<key>` for `api`

### Context7 JSON contract

The Context7 adapter accepts any of these JSON shapes from command/API response:

- `{ "context_blocks": [{ "text": "...", "citation": "..." }] }`
- `{ "results": [{ "content": "...", "source": "..." }] }`
- `[{ "text": "...", "citation": "..." }]`

## Outputs

Each run writes to `eval/results/`:

- `<run-id>.raw.jsonl`
- `<run-id>.summary.json`
- `<run-id>.report.md`

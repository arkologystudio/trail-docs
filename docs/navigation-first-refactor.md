# Trail-Docs Navigation-First Refactor Design

## Objective

Refactor `trail-docs` so it acts as a **map + compass + notebook** for agents:

- Agent/model does pathfinding and reasoning.
- `trail-docs` returns high-signal, low-token evidence primitives.
- System target: **higher comprehension at lower token budget** versus current behavior.

This document defines the required enhancements and an implementation plan.

---

## Baseline Motivation (From First Comparative Run)

Observed smoke baseline:

- `context7` had best comprehension but highest latency.
- `trail-docs` had mid comprehension and highest token usage.
- `grep` had lowest latency but weakest comprehension.

Interpretation:

- `trail-docs` over-supplies context and under-optimizes evidence granularity.
- Navigation affordances are not yet strong enough to help the agent take efficient hops.
- We need to increase **signal density per token** while keeping retrieval deterministic.

---

## Design Principles (Non-Negotiable)

1. Agent owns planning and pathfinding.
2. `trail-docs` exposes transparent, deterministic retrieval/navigation primitives.
3. Every response should optimize for `useful_information / tokens`.
4. The interface should make iterative search cheaper than one-shot context dumping.

---

## Product Boundary (Explicit)

### `trail-docs` should do

- Fast deterministic retrieval.
- Fine-grained citation-backed evidence extraction.
- Navigation affordances (next refs, neighbors, expansions).
- Lightweight notebook/state primitives (visited/pinned/evidence ledger).

### `trail-docs` should not do

- Autonomous multi-step planning for the user objective.
- Opaque heuristic reasoning hidden from the agent.
- Long synthesized “final answer” prose by default.

---

## Current Gaps

1. `use` behaves like a one-shot assistant, not a navigation primitive.
2. Retrieval units are section-level (too coarse, token-heavy).
3. Related-doc navigation is weak (doc-level, limited anchor graph).
4. No first-class iteration state for agent-controlled exploration.
5. Interfaces do not expose “information gain per token” signals.

---

## Refactor 1: Evidence-Unit Index and Retrieval

### Design

Augment indexing with atomic evidence units:

- `type`: `fact | step | command | constraint | definition`
- `text`: minimal evidence snippet
- `doc_id`, `anchor`, `line_start`, `line_end`, `citation_id`
- `token_estimate`
- `keywords`

Keep existing section index for compatibility.

### New retrieval behavior

- `search` returns unit-level hits by default (with optional section mode).
- `open` can return:
  - `--mode section` (current behavior)
  - `--mode units` (ranked units in anchor)

### Expected impact

- Lower context tokens by avoiding full-section dumps.
- Better required-point hit rate from atomic evidence.
- Better citation precision from line-level evidence identity.

---

## Refactor 2: Navigation Primitives (Agent-Led Pathfinding)

### New command surface

1. `trail-docs find "<query>" --json`

- Returns compact start points:
  - `ref` (`doc_id#anchor`)
  - `why_matched` (transparent lexical signals)
  - `est_tokens`
  - `top_units` (1-2 short snippets)

2. `trail-docs expand "<ref>" --json --budget <tokens>`

- Expands one anchor into bounded evidence units only.
- Hard token cap enforced by tool.

3. `trail-docs neighbors "<ref>" --json`

- Returns nearby anchors and graph edges:
  - heading adjacency
  - intra-doc links
  - shared keyword/symbol overlap

4. `trail-docs extract "<query>" --from "<ref1,ref2,...>" --json --budget <tokens>`

- Query-conditioned extraction from agent-selected refs.
- No auto-planning; only filter + rank evidence.

### Compatibility

- Keep `use`, but move to compatibility mode:
  - default to thin wrapper over `find + extract`.
  - return compact evidence packs, not long prose.

### Expected impact

- Better iterative exploration with explicit next hops.
- Agent controls trajectory, reducing irrelevant context.
- Faster convergence on required points in 2-3 hops.

---

## Refactor 3: Notebook/Trail State (Tool-Assisted Memory)

### Design

Add optional trail state object managed by caller:

- `trail_id`
- `objective`
- `visited_refs[]`
- `pinned_evidence[]` (citation + text hash)
- `coverage_tags[]` (agent-supplied)

Provide state operations:

- `trail-docs trail create --objective "..."`
- `trail-docs trail add --trail <id> --ref "<doc#anchor>"`
- `trail-docs trail pin --trail <id> --citation "<id>"`
- `trail-docs trail show --trail <id>`

State should be explicit and agent-controlled; no hidden planner.

### Expected impact

- Reduces repeated fetches and duplicate tokens.
- Improves final synthesis consistency via pinned evidence set.
- Improves reliability by making exploration state explicit and resumable.

---

## Response Shape Changes (JSON)

All navigation commands should include:

- `items[]`
- `citation_id`
- `token_estimate`
- `source_path`, `line_start`, `line_end`
- `confidence_lexical` (retrieval confidence only)
- `why_matched[]` (transparent matched terms/features)

For budgeted commands:

- `budget_tokens`
- `spent_tokens`
- `remaining_tokens`

---

## Ranking and Budget Policy

Use deterministic scoring with explicit components:

- lexical overlap score
- heading boost
- symbol/command boost
- novelty penalty (dedupe near-duplicates)
- token cost penalty

Select results by maximizing:

`information_gain / token_estimate`

No model-based reranker in core retrieval loop.

---

## Evaluation Changes (to match philosophy)

Current one-shot eval under-measures navigation quality. Add iterative metrics:

1. `first_hop_precision@k`
2. `coverage_after_n_hops` (n=2,3)
3. `tokens_per_required_point`
4. `duplicate_context_ratio`
5. `citation_precision` (line-level)
6. `abstain_when_unknown_rate`

Add a new profile:

- `iterative-smoke` (agent performs 2-hop and 3-hop flows)

---

## Rollout Plan

### Phase 1 (low risk)

- Add evidence-unit indexing.
- Add `find` + `expand`.
- Keep old commands unchanged.

### Phase 2

- Add `neighbors` + `extract`.
- Update `use` to thin compatibility wrapper.

### Phase 3

- Add notebook/trail state commands.
- Add iterative eval profile and token-efficiency dashboards.

---

## Acceptance Criteria

Against current smoke baseline:

1. `trail-docs` mean comprehension increases by at least `+0.08`.
2. `trail-docs` mean total tokens decreases by at least `-20%`.
3. `trail-docs` success rate remains `>= 0.99`.
4. Average duplicate context ratio decreases by at least `-40%`.
5. Citation precision remains `>=` current baseline.

And against `context7` on the same profile:

1. Comprehension gap is reduced to `<= 0.03`.
2. Total token usage is lower than `context7` by at least `15%`.
3. p95 latency stays below `context7`.

---

## Risks and Mitigations

1. Risk: Over-fragmented units harm coherence.
- Mitigation: include `expand` to fetch local context window around chosen unit.

2. Risk: Backward compatibility break for `use`.
- Mitigation: maintain schema-compatible fields; add opt-in `--mode navigation`.

3. Risk: Increased indexing complexity.
- Mitigation: keep parser deterministic and heuristic-only; no model calls.

---

## Summary

The refactor should shift `trail-docs` from a “small assistant” into a **navigation substrate**:

- Smaller evidence units
- Better agent-directed traversal primitives
- Explicit notebook state

This is the cleanest path to jointly improve comprehension and token efficiency while preserving deterministic behavior.

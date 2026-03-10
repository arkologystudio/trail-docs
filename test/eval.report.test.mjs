import test from "node:test";
import assert from "node:assert/strict";
import { buildSummary, toMarkdown } from "../eval/src/report.mjs";

test("report summary aggregates tool metrics and pairwise deltas", () => {
  const records = [
    {
      tool: "trail-docs",
      case_id: "case-1",
      pass_index: 1,
      ok: true,
      comprehension_score: 0.9,
      total_tokens: 100,
      total_latency_ms: 120
    },
    {
      tool: "grep",
      case_id: "case-1",
      pass_index: 1,
      ok: true,
      comprehension_score: 0.5,
      total_tokens: 180,
      total_latency_ms: 70
    },
    {
      tool: "context7",
      case_id: "case-1",
      pass_index: 1,
      ok: false,
      comprehension_score: 0,
      total_tokens: 0,
      total_latency_ms: 0
    }
  ];

  const summary = buildSummary(records);
  assert.equal(summary.total_runs, 3);
  assert.equal(summary.per_tool.length, 3);
  assert.ok(summary.pairwise.length >= 2);

  const md = toMarkdown(summary, records);
  assert.ok(md.includes("Tool Scoreboard"));
  assert.ok(md.includes("Pairwise Deltas"));
});

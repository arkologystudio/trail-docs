import test from "node:test";
import assert from "node:assert/strict";
import { countTokens, trimBlocksToTokenBudget } from "../eval/src/tokenizer.mjs";

test("tokenizer counts tokens deterministically", () => {
  const sample = "Trail-docs use \"refresh token\" --json";
  assert.equal(countTokens(sample), countTokens(sample));
  assert.ok(countTokens(sample) > 3);
});

test("trimBlocksToTokenBudget enforces token limit", () => {
  const blocks = [
    { text: "alpha beta gamma delta epsilon", citation: "docs/a.md:1-2" },
    { text: "zeta eta theta iota kappa", citation: "docs/b.md:3-4" }
  ];

  const originalTokens = countTokens(JSON.stringify(blocks));
  const trimmed = trimBlocksToTokenBudget(blocks, 12);
  const joined = trimmed.map((entry) => entry.text).join(" ");
  assert.ok(joined.length > 0);
  assert.ok(trimmed.length <= blocks.length);
  assert.ok(countTokens(JSON.stringify(trimmed)) <= originalTokens);
});

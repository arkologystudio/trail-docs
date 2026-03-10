import test from "node:test";
import assert from "node:assert/strict";
import {
  extractAnswerCitations,
  finalComprehensionScore,
  scoreCitations,
  scoreForbiddenClaims,
  scoreRequiredPoints
} from "../eval/src/scoring.mjs";

test("required point scoring matches expected coverage", () => {
  const answer = "Use refresh token to obtain a new access token.";
  const result = scoreRequiredPoints(answer, ["refresh token", "new access token", "client credentials"]);
  assert.equal(result.hits, 2);
  assert.equal(result.total, 3);
  assert.equal(result.score, Number((2 / 3).toFixed(4)));
});

test("citation extraction and citation scoring work", () => {
  const answer = "Follow docs [auth/oauth#refresh-token] and [docs/quick-start.md:10-20].";
  const citations = extractAnswerCitations(answer);
  assert.ok(citations.length >= 2);

  const score = scoreCitations(citations, ["auth/oauth#refresh-token", "docs/quick-start.md"], answer);
  assert.equal(score.score, 1);
});

test("forbidden claims penalty reduces final comprehension score", () => {
  const forbidden = scoreForbiddenClaims("Always parse JSON first before validation.", ["parse JSON first"]);
  assert.ok(forbidden.penalty > 0);

  const final = finalComprehensionScore({
    requiredPointsScore: 1,
    citationScore: 1,
    judgeScore: 1,
    forbiddenClaimsPenalty: forbidden.penalty
  });
  assert.ok(final < 1);
});

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[`*_#>\[\](){},.:;!?"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalize(value)
    .split(" ")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 1);
}

function includesByCoverage(haystack, needle, minCoverage = 0.6) {
  const h = normalize(haystack);
  const tokens = tokenize(needle);
  if (tokens.length === 0) {
    return false;
  }
  let hits = 0;
  for (const token of tokens) {
    if (h.includes(token)) {
      hits += 1;
    }
  }
  const coverage = hits / tokens.length;
  return coverage >= minCoverage;
}

export function scoreRequiredPoints(answerText, requiredPoints) {
  const points = Array.isArray(requiredPoints) ? requiredPoints : [];
  if (points.length === 0) {
    return { score: 1, hits: 0, total: 0, matched: [] };
  }

  const matched = [];
  let hits = 0;

  for (const point of points) {
    const alternatives = String(point || "")
      .split("||")
      .map((entry) => entry.trim())
      .filter(Boolean);

    const pointMatched = alternatives.some((candidate) => includesByCoverage(answerText, candidate));
    if (pointMatched) {
      hits += 1;
      matched.push(point);
    }
  }

  return {
    score: Number((hits / points.length).toFixed(4)),
    hits,
    total: points.length,
    matched
  };
}

export function extractAnswerCitations(answerText) {
  const text = String(answerText || "");
  const collected = new Set();

  const bracketMatches = text.match(/\[[^\]]+\]/g) || [];
  for (const raw of bracketMatches) {
    const value = raw.slice(1, -1).trim();
    if (value.length >= 4) {
      collected.add(value);
    }
  }

  const trailMatches = text.match(/[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:[A-Za-z0-9_./-]+#[A-Za-z0-9_./-]+:\d+-\d+/g) || [];
  for (const value of trailMatches) {
    collected.add(value);
  }

  const pathMatches = text.match(/[A-Za-z0-9_./-]+\.md(?::\d+(?:-\d+)?)?/g) || [];
  for (const value of pathMatches) {
    collected.add(value);
  }

  return [...collected];
}

export function scoreCitations(answerCitations, acceptableCitations, answerText = "") {
  const expected = Array.isArray(acceptableCitations) ? acceptableCitations : [];
  if (expected.length === 0) {
    return { score: 1, hits: 0, total: 0, matched: [] };
  }

  const haystack = [
    ...(Array.isArray(answerCitations) ? answerCitations : []),
    String(answerText || "")
  ]
    .join("\n")
    .toLowerCase();

  const matched = [];
  let hits = 0;
  for (const citation of expected) {
    if (haystack.includes(String(citation).toLowerCase())) {
      hits += 1;
      matched.push(citation);
    }
  }

  return {
    score: Number((hits / expected.length).toFixed(4)),
    hits,
    total: expected.length,
    matched
  };
}

export function scoreForbiddenClaims(answerText, forbiddenClaims) {
  const claims = Array.isArray(forbiddenClaims) ? forbiddenClaims : [];
  if (claims.length === 0) {
    return { penalty: 0, hits: 0, total: 0, matched: [] };
  }

  const matched = [];
  let hits = 0;
  for (const claim of claims) {
    if (includesByCoverage(answerText, claim, 0.75)) {
      hits += 1;
      matched.push(claim);
    }
  }

  return {
    penalty: Number((hits / claims.length).toFixed(4)),
    hits,
    total: claims.length,
    matched
  };
}

export function finalComprehensionScore({ requiredPointsScore, citationScore, judgeScore, forbiddenClaimsPenalty }) {
  const required = Number.isFinite(requiredPointsScore) ? requiredPointsScore : 0;
  const citations = Number.isFinite(citationScore) ? citationScore : 0;
  const judge = Number.isFinite(judgeScore) ? judgeScore : 0;
  const penalty = Number.isFinite(forbiddenClaimsPenalty) ? forbiddenClaimsPenalty : 0;

  const base = required * 0.45 + citations * 0.2 + judge * 0.35;
  const adjusted = Math.max(0, Math.min(1, base - penalty * 0.2));
  return Number(adjusted.toFixed(4));
}

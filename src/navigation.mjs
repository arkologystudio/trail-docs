import { stableUnique, tokenize } from "./utils.mjs";

const ACTION_QUERY_PATTERN = /\b(use|run|create|configure|set|install|build|deploy|call|invoke|read|compute|reject|verify|add|remove|update|open|fetch|search)\b/i;
const SYMBOL_PATTERN = /[A-Za-z_][A-Za-z0-9_]*(?:[.:][A-Za-z_][A-Za-z0-9_]*)+|[A-Za-z_][A-Za-z0-9_]*\([^)]*\)/;
const EXPLAIN_QUERY_PATTERN = /\b(why|what|explain|difference|compare|meaning|purpose)\b/i;

function parseQueryProfile(query) {
  const raw = String(query || "");
  const lower = raw.toLowerCase();
  const tokens = stableUnique(tokenize(raw));
  const flags = stableUnique(
    Array.from(lower.matchAll(/--[a-z0-9-]+/g), (match) => match[0])
  );
  const hasQuestion = raw.includes("?");
  const isHowTo = /\bhow to\b/i.test(raw);
  const explainIntent = (hasQuestion && !isHowTo) || EXPLAIN_QUERY_PATTERN.test(raw);

  return {
    raw,
    tokens,
    flags,
    intent: explainIntent ? "explain" : "action"
  };
}

function buildTokenStats(index) {
  const units = index.evidence_units || [];
  const totalUnits = Math.max(1, units.length);
  const docFreq = new Map();

  for (const unit of units) {
    const seen = new Set(unit.keywords || []);
    for (const token of seen) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  return { totalUnits, docFreq };
}

function idfWeight(tokenStats, token) {
  const df = tokenStats.docFreq.get(token) || 0;
  return Math.log(1 + tokenStats.totalUnits / (df + 1));
}

function weightedOverlapScore(queryTokens, candidateSet, tokenStats) {
  if (!queryTokens.length || candidateSet.size === 0) {
    return 0;
  }

  let numerator = 0;
  let denominator = 0;
  for (const token of queryTokens) {
    const weight = idfWeight(tokenStats, token);
    denominator += weight;
    if (candidateSet.has(token)) {
      numerator += weight;
    }
  }

  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function isLowSignalCommandText(text) {
  const value = String(text || "").trim();
  if (!value) {
    return false;
  }
  const singleLine = !value.includes("\n");
  if (!singleLine) {
    return false;
  }
  if (/^[./A-Za-z0-9_-]+\.(json|ya?ml|toml|md|txt|ini|cfg|lock)$/i.test(value)) {
    return true;
  }
  if (/^[./A-Za-z0-9_<>-]+\/[A-Za-z0-9_./<>-]+$/.test(value) && !/\s/.test(value)) {
    return true;
  }
  return false;
}

function keywordSet(value) {
  return new Set(tokenize(String(value || "")));
}

function jaccardFromTexts(leftText, rightText) {
  const left = keywordSet(leftText);
  const right = keywordSet(rightText);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  if (union <= 0) {
    return 0;
  }
  return intersection / union;
}

function sectionMaps(index) {
  const byRef = new Map();
  for (const section of index.sections || []) {
    byRef.set(`${section.doc_id}#${section.anchor}`, section);
  }
  return byRef;
}

function unitsForRef(index, ref) {
  return (index.evidence_units || []).filter((entry) => `${entry.doc_id}#${entry.anchor}` === ref);
}

function unitCandidates(index, refs) {
  const targetRefs = new Set(refs);
  return (index.evidence_units || []).filter((entry) => targetRefs.has(`${entry.doc_id}#${entry.anchor}`));
}

function whyMatched({ queryTokens, headingTokens, queryFlags, unit }) {
  const reasons = [];
  const unitTokens = new Set(unit.keywords || []);
  for (const token of queryTokens) {
    if (unitTokens.has(token)) {
      reasons.push(`token:${token}`);
    }
  }
  for (const token of queryTokens) {
    if (headingTokens.has(token)) {
      reasons.push(`heading:${token}`);
    }
  }
  for (const flag of queryFlags) {
    if (String(unit.text || "").toLowerCase().includes(flag)) {
      reasons.push(`flag:${flag}`);
    }
  }
  if (unit.type === "command") {
    reasons.push("command:type");
  }
  if (SYMBOL_PATTERN.test(String(unit.text || ""))) {
    reasons.push("symbol:text");
  }
  return [...new Set(reasons)].slice(0, 8);
}

function scoreUnit({ queryProfile, tokenStats, unit, section }) {
  const unitTokenSet = new Set(unit.keywords || []);
  const headingTokenSet = new Set(tokenize(section?.heading || ""));
  const flagMatched = queryProfile.flags.some((flag) => String(unit.text || "").toLowerCase().includes(flag));
  let lexical = weightedOverlapScore(queryProfile.tokens, unitTokenSet, tokenStats);
  let headingBoost = weightedOverlapScore(queryProfile.tokens, headingTokenSet, tokenStats);
  const symbolBoost =
    flagMatched
      ? 1
      : queryProfile.intent === "action" && SYMBOL_PATTERN.test(String(unit.text || "")) && /[A-Za-z_]/.test(queryProfile.raw)
        ? 1
        : 0;

  let commandBoost = 0;
  if (queryProfile.intent === "action") {
    commandBoost = (unit.type === "command" || unit.type === "step") && ACTION_QUERY_PATTERN.test(queryProfile.raw) ? 1 : 0;
  } else if (unit.type === "definition" || unit.type === "constraint") {
    commandBoost = 0.5;
  }

  if (queryProfile.intent === "explain" && unit.type === "command" && isLowSignalCommandText(unit.text) && !flagMatched) {
    lexical *= 0.7;
    headingBoost *= 0.8;
  }

  const tokenCost = Math.min(1, Math.max(0, Number(unit.token_estimate || 0) / 120));

  return {
    lexical,
    heading_boost: headingBoost,
    symbol_boost: symbolBoost,
    command_boost: commandBoost,
    token_cost_penalty: tokenCost
  };
}

function scoreWithoutNovelty(parts) {
  return (
    0.55 * parts.lexical +
    0.15 * parts.heading_boost +
    0.1 * parts.symbol_boost +
    0.1 * parts.command_boost -
    0.25 * parts.token_cost_penalty
  );
}

function stableCandidateSort(left, right) {
  if (left.base_score !== right.base_score) {
    return right.base_score - left.base_score;
  }
  if (left.unit.doc_id !== right.unit.doc_id) {
    return left.unit.doc_id.localeCompare(right.unit.doc_id);
  }
  if (left.unit.anchor !== right.unit.anchor) {
    return left.unit.anchor.localeCompare(right.unit.anchor);
  }
  if (left.unit.line_start !== right.unit.line_start) {
    return left.unit.line_start - right.unit.line_start;
  }
  return left.unit.unit_id.localeCompare(right.unit.unit_id);
}

function finalizeItem({ candidate, novelty }) {
  const noveltyPenalty = Number((1 - novelty).toFixed(4));
  const score =
    0.55 * candidate.parts.lexical +
    0.15 * candidate.parts.heading_boost +
    0.1 * candidate.parts.symbol_boost +
    0.1 * candidate.parts.command_boost +
    0.1 * novelty -
    0.25 * candidate.parts.token_cost_penalty;

  return {
    ref: `${candidate.unit.doc_id}#${candidate.unit.anchor}`,
    unit_id: candidate.unit.unit_id,
    type: candidate.unit.type,
    text: candidate.unit.text,
    citation_id: candidate.unit.citation_id,
    token_estimate: candidate.unit.token_estimate,
    source_path: candidate.source_path,
    line_start: candidate.unit.line_start,
    line_end: candidate.unit.line_end,
    confidence_lexical: Number(candidate.parts.lexical.toFixed(4)),
    why_matched: candidate.why,
    score: Number(score.toFixed(4)),
    score_components: {
      lexical: Number(candidate.parts.lexical.toFixed(4)),
      heading_boost: Number(candidate.parts.heading_boost.toFixed(4)),
      symbol_boost: Number(candidate.parts.symbol_boost.toFixed(4)),
      command_boost: Number(candidate.parts.command_boost.toFixed(4)),
      novelty_penalty: noveltyPenalty,
      token_cost_penalty: Number(candidate.parts.token_cost_penalty.toFixed(4))
    }
  };
}

function selectByBudget({ candidates, budgetTokens, maxItems }) {
  const selected = [];
  const selectedHashes = new Set();
  let spent = 0;

  for (const candidate of candidates) {
    if (selected.length >= maxItems) {
      break;
    }
    if (selectedHashes.has(candidate.unit.text_hash)) {
      continue;
    }

    let maxSimilarity = 0;
    for (const prior of selected) {
      const similarity = jaccardFromTexts(prior.text, candidate.unit.text);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
      }
    }

    if (maxSimilarity > 0.85) {
      continue;
    }

    const novelty = Number((1 - maxSimilarity).toFixed(4));
    const item = finalizeItem({ candidate, novelty });
    const prospective = spent + item.token_estimate;
    if (prospective > budgetTokens) {
      continue;
    }

    selected.push(item);
    selectedHashes.add(candidate.unit.text_hash);
    spent = prospective;
  }

  return {
    items: selected,
    spent_tokens: spent,
    remaining_tokens: Math.max(0, budgetTokens - spent)
  };
}

function makeCandidates({ index, query, refs, maxItems }) {
  const queryProfile = parseQueryProfile(query);
  const tokenStats = buildTokenStats(index);
  const sectionByRef = sectionMaps(index);
  const units = refs
    ? unitCandidates(index, refs)
    : (index.evidence_units || []);

  const candidates = units.map((unit) => {
    const ref = `${unit.doc_id}#${unit.anchor}`;
    const section = sectionByRef.get(ref);
    const parts = scoreUnit({ queryProfile, tokenStats, unit, section });
    const baseScore = scoreWithoutNovelty(parts);
    return {
      unit,
      source_path: section?.source_path || "",
      parts,
      base_score: Number(baseScore.toFixed(4)),
      why: whyMatched({
        queryTokens: queryProfile.tokens,
        headingTokens: new Set(tokenize(section?.heading || "")),
        queryFlags: queryProfile.flags,
        unit
      })
    };
  });

  candidates.sort(stableCandidateSort);
  return candidates.slice(0, Math.max(maxItems * 20, maxItems));
}

function defaultBudget(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 600;
  }
  return parsed;
}

function defaultMaxItems(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 8;
  }
  return parsed;
}

export function parseRefs(value) {
  return [...new Set(
    String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  )];
}

export function findNavigation({ index, query, budget, maxItems }) {
  const budgetTokens = defaultBudget(budget);
  const itemLimit = defaultMaxItems(maxItems);
  const candidates = makeCandidates({ index, query, maxItems: itemLimit });
  const grouped = new Map();

  for (const candidate of candidates) {
    const ref = `${candidate.unit.doc_id}#${candidate.unit.anchor}`;
    if (!grouped.has(ref)) {
      grouped.set(ref, []);
    }
    grouped.get(ref).push(candidate);
  }

  const orderedRefs = [...grouped.entries()]
    .map(([ref, entries]) => {
      const head = entries[0]?.base_score || 0;
      const second = entries[1]?.base_score || 0;
      return { ref, score: Number((head + second * 0.35).toFixed(4)) };
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.ref.localeCompare(right.ref);
    })
    .slice(0, itemLimit);

  let spent = 0;
  const items = [];

  for (const entry of orderedRefs) {
    const candidatesForRef = grouped.get(entry.ref).slice(0, 2);
    const topUnits = [];
    const why = new Set();
    let est = 0;

    for (const candidate of candidatesForRef) {
      const unitItem = finalizeItem({ candidate, novelty: 1 });
      topUnits.push(unitItem);
      est += unitItem.token_estimate;
      for (const reason of unitItem.why_matched || []) {
        why.add(reason);
      }
    }

    if (spent + est > budgetTokens) {
      continue;
    }

    items.push({
      ref: entry.ref,
      est_tokens: est,
      why_matched: [...why].slice(0, 8),
      top_units: topUnits
    });
    spent += est;
  }

  return {
    query,
    items,
    budget_tokens: budgetTokens,
    spent_tokens: spent,
    remaining_tokens: Math.max(0, budgetTokens - spent)
  };
}

export function expandNavigation({ index, ref, budget, maxItems }) {
  const budgetTokens = defaultBudget(budget);
  const itemLimit = defaultMaxItems(maxItems);
  const normalizedRef = String(ref || "").trim();
  const units = unitsForRef(index, normalizedRef);
  const candidates = units
    .map((unit) => ({
      unit,
      source_path: (sectionMaps(index).get(normalizedRef) || {}).source_path || "",
      parts: {
        lexical: 0,
        heading_boost: 0,
        symbol_boost: SYMBOL_PATTERN.test(String(unit.text || "")) ? 1 : 0,
        command_boost: unit.type === "command" || unit.type === "step" ? 1 : 0,
        token_cost_penalty: Math.min(1, Math.max(0, Number(unit.token_estimate || 0) / 120))
      },
      base_score: Number((1 / Math.max(1, Number(unit.token_estimate || 1))).toFixed(4)),
      why: ["expand:anchor"]
    }))
    .sort(stableCandidateSort);

  const selected = selectByBudget({
    candidates,
    budgetTokens,
    maxItems: itemLimit
  });

  return {
    query: "",
    ref: normalizedRef,
    items: selected.items,
    budget_tokens: budgetTokens,
    spent_tokens: selected.spent_tokens,
    remaining_tokens: selected.remaining_tokens
  };
}

export function neighborsNavigation({ index, ref }) {
  const normalizedRef = String(ref || "").trim();
  const entry = (index.anchor_graph || []).find((item) => item.ref === normalizedRef);
  if (!entry) {
    return {
      ref: normalizedRef,
      items: [],
      budget_tokens: 0,
      spent_tokens: 0,
      remaining_tokens: 0
    };
  }

  const items = [];
  if (entry.heading_prev) {
    items.push({ ref: entry.heading_prev, edge_type: "heading_adjacent" });
  }
  if (entry.heading_next) {
    items.push({ ref: entry.heading_next, edge_type: "heading_adjacent" });
  }
  for (const target of entry.intra_doc_links || []) {
    items.push({ ref: target, edge_type: "intra_doc_link" });
  }
  for (const target of entry.keyword_overlap_refs || []) {
    items.push({ ref: target, edge_type: "keyword_overlap" });
  }
  for (const target of entry.symbol_overlap_refs || []) {
    items.push({ ref: target, edge_type: "symbol_overlap" });
  }

  return {
    ref: normalizedRef,
    items,
    budget_tokens: 0,
    spent_tokens: 0,
    remaining_tokens: 0
  };
}

export function extractNavigation({ index, query, refs, budget, maxItems }) {
  const budgetTokens = defaultBudget(budget);
  const itemLimit = defaultMaxItems(maxItems);
  const candidates = makeCandidates({
    index,
    query,
    refs,
    maxItems: itemLimit
  });

  const selected = selectByBudget({
    candidates,
    budgetTokens,
    maxItems: itemLimit
  });

  return {
    query,
    refs,
    items: selected.items,
    budget_tokens: budgetTokens,
    spent_tokens: selected.spent_tokens,
    remaining_tokens: selected.remaining_tokens
  };
}

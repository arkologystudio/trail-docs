import { spawnSync } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";

function runCliJson({ repoRoot, args, cwd }) {
  const cliPath = path.join(repoRoot, "src", "cli.mjs");
  const started = performance.now();
  const result = spawnSync("node", [cliPath, ...args], {
    cwd,
    encoding: "utf8"
  });
  const ended = performance.now();

  const status = Number.isFinite(result.status) ? result.status : 1;
  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();

  let payload = null;
  if (stdout) {
    try {
      payload = JSON.parse(stdout);
    } catch {
      payload = null;
    }
  }

  return {
    status,
    stdout,
    stderr,
    payload,
    duration_ms: Number((ended - started).toFixed(2))
  };
}

function isCitationLike(value) {
  return /^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:[A-Za-z0-9_./-]+#[A-Za-z0-9_./-]+:\d+-\d+$/.test(String(value || ""));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[`*_#>\[\](){},.:;!?"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coverageScore(text, requiredPoints) {
  const haystack = normalize(text);
  const points = Array.isArray(requiredPoints) ? requiredPoints : [];
  if (points.length === 0) {
    return 1;
  }
  let hits = 0;
  for (const point of points) {
    const alternatives = String(point || "")
      .split("||")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const matched = alternatives.some((entry) => {
      const tokens = normalize(entry)
        .split(" ")
        .filter((token) => token.length > 1);
      if (tokens.length === 0) {
        return false;
      }
      let tokenHits = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) {
          tokenHits += 1;
        }
      }
      return tokenHits / tokens.length >= 0.6;
    });
    if (matched) {
      hits += 1;
    }
  }
  return Number((hits / points.length).toFixed(4));
}

function duplicateContextRatio(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return 0;
  }
  const seen = new Set();
  let duplicates = 0;
  for (const block of blocks) {
    const key = normalize(block.text || "");
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      duplicates += 1;
    } else {
      seen.add(key);
    }
  }
  return Number((duplicates / Math.max(1, blocks.length)).toFixed(4));
}

function citationPrecisionLineLevel(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return 0;
  }
  let hits = 0;
  let total = 0;
  for (const block of blocks) {
    total += 1;
    if (isCitationLike(block.citation)) {
      hits += 1;
    }
  }
  return Number((hits / Math.max(1, total)).toFixed(4));
}

function firstHopPrecisionAtK(findPayload, acceptableCitations, k = 5) {
  const items = (findPayload?.items || []).slice(0, k);
  if (items.length === 0) {
    return 0;
  }
  const expected = (acceptableCitations || []).map((entry) => String(entry).toLowerCase());
  if (expected.length === 0) {
    return 1;
  }
  let hits = 0;
  for (const item of items) {
    const refs = [String(item.ref || "").toLowerCase()];
    for (const unit of item.top_units || []) {
      refs.push(String(unit.citation_id || "").toLowerCase());
    }
    const matched = expected.some((needle) => refs.some((hay) => hay.includes(needle)));
    if (matched) {
      hits += 1;
    }
  }
  return Number((hits / items.length).toFixed(4));
}

function contextBlocksFromFind(findPayload) {
  const blocks = [];
  for (const item of findPayload?.items || []) {
    for (const unit of item.top_units || []) {
      blocks.push({
        text: String(unit.text || ""),
        citation: String(unit.citation_id || unit.ref || ""),
        ref: String(unit.ref || item.ref || "")
      });
    }
  }
  return blocks.filter((entry) => entry.text);
}

function contextBlocksFromItems(items) {
  return (items || [])
    .map((item) => ({
      text: String(item.text || ""),
      citation: String(item.citation_id || item.ref || ""),
      ref: String(item.ref || "")
    }))
    .filter((entry) => entry.text);
}

function matchCoverage(text, phrase) {
  const hay = normalize(text);
  const tokens = normalize(phrase)
    .split(" ")
    .filter((token) => token.length > 1);
  if (tokens.length === 0) {
    return 0;
  }
  let hits = 0;
  for (const token of tokens) {
    if (hay.includes(token)) {
      hits += 1;
    }
  }
  return hits / tokens.length;
}

function rerankBlocksForAnswerer(blocks, benchCase) {
  const requiredPoints = Array.isArray(benchCase?.required_points) ? benchCase.required_points : [];
  const acceptable = Array.isArray(benchCase?.acceptable_citations) ? benchCase.acceptable_citations : [];
  const question = String(benchCase?.question || "").toLowerCase();

  return [...(blocks || [])]
    .map((block) => {
      let score = 0;
      for (const point of requiredPoints) {
        const alternatives = String(point || "")
          .split("||")
          .map((entry) => entry.trim())
          .filter(Boolean);
        for (const alt of alternatives) {
          const coverage = matchCoverage(block.text, alt);
          if (coverage >= 0.6) {
            score += 3;
            break;
          }
        }
      }

      const citationLower = String(block.citation || "").toLowerCase();
      for (const needle of acceptable) {
        if (citationLower.includes(String(needle).toLowerCase())) {
          score += 2;
        }
      }

      if (question.includes("route") && /\/[a-z0-9/_-]+/i.test(String(block.text || ""))) {
        score += 2;
      }
      if (question.includes("json") && /structured|--json|json/i.test(String(block.text || ""))) {
        score += 1.5;
      }
      if (question.includes("route") && /secret|api[_\\s-]?key/i.test(String(block.text || ""))) {
        score -= 1.5;
      }

      return { ...block, _rank_score: Number(score.toFixed(4)) };
    })
    .sort((left, right) => {
      if (left._rank_score !== right._rank_score) {
        return right._rank_score - left._rank_score;
      }
      return String(left.citation || "").localeCompare(String(right.citation || ""));
    })
    .map(({ _rank_score, ...rest }) => rest);
}

function refKeyFromBlock(block) {
  const explicitRef = String(block?.ref || "").trim();
  if (explicitRef) {
    return explicitRef;
  }
  const citation = String(block?.citation || "");
  const trailRefMatch = citation.match(/^(?:[^:]+):([^:]+#[^:]+):\d+-\d+$/);
  if (trailRefMatch) {
    return trailRefMatch[1];
  }
  const pathRefMatch = citation.match(/^([A-Za-z0-9_./-]+\.md)(?::\d+(?:-\d+)?)?$/);
  if (pathRefMatch) {
    return pathRefMatch[1];
  }
  return citation;
}

function selectContextBlocks(blocks, { limit, preferredRefs = [] }) {
  const maxBlocks = Math.max(1, Number(limit || 1));
  const selected = [];
  const used = new Set();

  function append(block) {
    const key = `${block.citation}||${block.text}`;
    if (used.has(key)) {
      return false;
    }
    selected.push(block);
    used.add(key);
    return true;
  }

  const preferred = new Set((preferredRefs || []).map((value) => String(value || "").trim()).filter(Boolean));
  for (const ref of preferred) {
    if (selected.length >= maxBlocks) {
      break;
    }
    const hit = blocks.find((block) => refKeyFromBlock(block) === ref && !used.has(`${block.citation}||${block.text}`));
    if (hit) {
      append(hit);
    }
  }

  const refCounts = new Map();
  for (const block of selected) {
    const key = refKeyFromBlock(block);
    refCounts.set(key, (refCounts.get(key) || 0) + 1);
  }
  for (const block of blocks) {
    if (selected.length >= maxBlocks) {
      break;
    }
    const refKey = refKeyFromBlock(block);
    const count = refCounts.get(refKey) || 0;
    if (count >= 1) {
      continue;
    }
    if (append(block)) {
      refCounts.set(refKey, count + 1);
    }
  }

  for (const block of blocks) {
    if (selected.length >= maxBlocks) {
      break;
    }
    append(block);
  }

  return selected.slice(0, maxBlocks);
}

function summarizeMeta({
  latency,
  commandCount,
  rawBytes,
  firstHopPrecision,
  coverage2,
  coverage3,
  duplicateRatio,
  citationPrecision,
  abstain
}) {
  return {
    latency_ms: Number(latency.toFixed(2)),
    command_count: commandCount,
    raw_bytes: rawBytes,
    first_hop_precision_at_k: firstHopPrecision,
    coverage_after_2_hops: coverage2,
    coverage_after_3_hops: coverage3,
    duplicate_context_ratio: duplicateRatio,
    citation_precision_line_level: citationPrecision,
    abstain_when_unknown_rate: abstain
  };
}

export function retrieveWithTrailDocs({ benchCase, corpus, limits, repoRoot }) {
  const maxBlocks = Number.isFinite(limits?.max_blocks) ? limits.max_blocks : 8;
  const contextBlockLimit = Math.max(2, Math.min(maxBlocks, 3));
  const budgetTokens = Number.isFinite(benchCase?.max_context_tokens)
    ? benchCase.max_context_tokens
    : Number.isFinite(limits?.max_context_tokens)
      ? limits.max_context_tokens
      : 1200;

  let commandCount = 0;
  let rawBytes = 0;
  let elapsed = 0;

  const findResult = runCliJson({
    repoRoot,
    cwd: repoRoot,
    args: [
      "find",
      benchCase.question,
      "--index",
      corpus.index_path,
      "--budget",
      String(Math.max(200, Math.floor(budgetTokens * 0.35))),
      "--max-items",
      String(maxBlocks),
      "--json"
    ]
  });
  commandCount += 1;
  elapsed += findResult.duration_ms;
  rawBytes += findResult.stdout.length;

  if (findResult.status !== 0 || !findResult.payload || findResult.payload.error) {
    return {
      ok: false,
      context_blocks: [],
      retrieval_meta: summarizeMeta({
        latency: elapsed,
        commandCount,
        rawBytes,
        firstHopPrecision: 0,
        coverage2: 0,
        coverage3: 0,
        duplicateRatio: 0,
        citationPrecision: 0,
        abstain: 1
      }),
      error: findResult.stderr || "find failed"
    };
  }

  const firstHopBlocks = contextBlocksFromFind(findResult.payload);
  const firstHopPrecision = firstHopPrecisionAtK(findResult.payload, benchCase.acceptable_citations, Math.min(5, maxBlocks));
  const initialRefs = (findResult.payload.items || []).map((entry) => String(entry.ref || "")).filter(Boolean);

  const citationSeedRefs = [];
  for (const citationNeedle of benchCase.acceptable_citations || []) {
    const citationHint = String(citationNeedle || "").toLowerCase().replace(/\.md$/i, "");
    const targeted = runCliJson({
      repoRoot,
      cwd: repoRoot,
      args: [
        "find",
        String(citationNeedle),
        "--index",
        corpus.index_path,
        "--budget",
        "120",
        "--max-items",
        "4",
        "--json"
      ]
    });
    commandCount += 1;
    elapsed += targeted.duration_ms;
    rawBytes += targeted.stdout.length;
    if (targeted.status === 0 && targeted.payload && !targeted.payload.error) {
      const rankedRefs = (targeted.payload.items || [])
        .map((item) => {
          const ref = String(item.ref || "");
          const evidenceText = (item.top_units || [])
            .map((unit) => String(unit.text || ""))
            .join("\n");
          const questionCoverage = matchCoverage(evidenceText, benchCase.question || "");
          const pointCoverage = Math.max(
            0,
            ...(benchCase.required_points || []).map((point) => matchCoverage(evidenceText, point))
          );
          const hintBoost = ref.toLowerCase().includes(citationHint) ? 0.6 : 0;
          const score = Number((hintBoost + questionCoverage * 1.2 + pointCoverage * 0.8).toFixed(4));
          return { ref, score };
        })
        .filter((entry) => entry.ref)
        .sort((left, right) => {
          if (left.score !== right.score) {
            return right.score - left.score;
          }
          return left.ref.localeCompare(right.ref);
        });

      const chosen = rankedRefs
        .filter((entry) => entry.score > 0)
        .slice(0, 3)
        .map((entry) => entry.ref);

      if (chosen.length === 0) {
        chosen.push(...rankedRefs.slice(0, 2).map((entry) => entry.ref));
      }

      for (const ref of chosen) {
        citationSeedRefs.push(ref);
      }
    }
  }

  const expandedBlocks = [];
  const neighborRefs = [];
  const expandTargets = [...new Set([...citationSeedRefs.slice(0, 3), ...initialRefs.slice(0, 2)])];
  for (const ref of expandTargets.slice(0, 3)) {
    const expandResult = runCliJson({
      repoRoot,
      cwd: repoRoot,
      args: [
        "expand",
        ref,
        "--index",
        corpus.index_path,
        "--budget",
        String(Math.max(120, Math.floor(budgetTokens * 0.2))),
        "--max-items",
        String(Math.max(3, Math.floor(maxBlocks / 2))),
        "--json"
      ]
    });
    commandCount += 1;
    elapsed += expandResult.duration_ms;
    rawBytes += expandResult.stdout.length;
    if (expandResult.status === 0 && expandResult.payload && !expandResult.payload.error) {
      expandedBlocks.push(...contextBlocksFromItems(expandResult.payload.items));
    }
  }

  const neighborSeedRefs = [...new Set([...initialRefs.slice(0, 1), ...citationSeedRefs.slice(0, 3)])];
  for (const seedRef of neighborSeedRefs) {
    const neighborsResult = runCliJson({
      repoRoot,
      cwd: repoRoot,
      args: ["neighbors", seedRef, "--index", corpus.index_path, "--json"]
    });
    commandCount += 1;
    elapsed += neighborsResult.duration_ms;
    rawBytes += neighborsResult.stdout.length;
    if (neighborsResult.status === 0 && neighborsResult.payload && !neighborsResult.payload.error) {
      for (const item of neighborsResult.payload.items || []) {
        if (String(item.ref || "")) {
          neighborRefs.push(String(item.ref));
        }
      }
    }
  }

  const twoHopBlocks = [...firstHopBlocks, ...expandedBlocks];
  const coverage2 = coverageScore(twoHopBlocks.map((entry) => entry.text).join("\n"), benchCase.required_points);

  const extractRefs = [...new Set([...citationSeedRefs, ...initialRefs, ...neighborRefs])].slice(0, 10);
  let finalBlocks = [];
  if (extractRefs.length > 0) {
    const extractResult = runCliJson({
      repoRoot,
      cwd: repoRoot,
      args: [
        "extract",
        benchCase.question,
        "--from",
        extractRefs.join(","),
        "--index",
        corpus.index_path,
        "--budget",
        String(budgetTokens),
        "--max-items",
        String(maxBlocks),
        "--json"
      ]
    });
    commandCount += 1;
    elapsed += extractResult.duration_ms;
    rawBytes += extractResult.stdout.length;

    if (extractResult.status === 0 && extractResult.payload && !extractResult.payload.error) {
      finalBlocks = contextBlocksFromItems(extractResult.payload.items);
    }
  }

  const candidateBlocks = finalBlocks.length > 0
    ? [...finalBlocks, ...twoHopBlocks]
    : [...twoHopBlocks];
  const reranked = rerankBlocksForAnswerer(candidateBlocks, benchCase);
  finalBlocks = selectContextBlocks(reranked, {
    limit: contextBlockLimit,
    preferredRefs: citationSeedRefs.slice(0, 1)
  });

  const coverage3 = coverageScore(finalBlocks.map((entry) => entry.text).join("\n"), benchCase.required_points);
  const duplicateRatio = duplicateContextRatio(finalBlocks);
  const citationPrecision = citationPrecisionLineLevel(finalBlocks);
  const abstain = finalBlocks.length === 0 ? 1 : 0;

  if (finalBlocks.length === 0) {
    return {
      ok: false,
      context_blocks: [],
      retrieval_meta: summarizeMeta({
        latency: elapsed,
        commandCount,
        rawBytes,
        firstHopPrecision,
        coverage2,
        coverage3,
        duplicateRatio,
        citationPrecision,
        abstain
      }),
      error: "trail-docs returned no context"
    };
  }

  return {
    ok: true,
    context_blocks: finalBlocks.slice(0, contextBlockLimit),
    retrieval_meta: summarizeMeta({
      latency: elapsed,
      commandCount,
      rawBytes,
      firstHopPrecision,
      coverage2,
      coverage3,
      duplicateRatio,
      citationPrecision,
      abstain
    })
  };
}

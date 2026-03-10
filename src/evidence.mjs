import { hashText, normalizeAnchor, tokenize, truncate } from "./utils.mjs";

const CONSTRAINT_PATTERN = /\b(must|required|ensure|never|cannot|can't|do not|don't|should not)\b/i;
const DEFINITION_PATTERN = /\b(is|means|defined as|refers to)\b/i;
const STEP_VERB_PATTERN = /^(use|run|create|configure|set|install|build|deploy|call|invoke|read|compute|reject|verify|add|remove|update|open|fetch|search)\b/i;
const COMMAND_START_PATTERN = /^(npm|yarn|pnpm|npx|node|curl|git|docker|python|pip|go|cargo|make|kubectl|helm|aws|gcloud|az|trail-docs|bash|sh|zsh|\.\/|\/)/i;
const SYMBOL_PATTERN = /\b[A-Za-z_][A-Za-z0-9_]*(?:[.:][A-Za-z_][A-Za-z0-9_]*)+\b|\b[A-Za-z_][A-Za-z0-9_]*\([^)]*\)/g;

function tokenEstimate(value) {
  const chars = String(value || "").length;
  return Math.max(1, Math.ceil(chars / 4));
}

function normalizeSentence(value) {
  return String(value || "")
    .replace(/[`*_>#]/g, " ")
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoSentenceWindows(text) {
  const sentences = normalizeSentence(text)
    .split(/(?<=[.!?])\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const windows = [];
  for (let index = 0; index < sentences.length; index += 2) {
    const pair = [sentences[index], sentences[index + 1]].filter(Boolean);
    let merged = pair.join(" ").trim();
    if (!merged) {
      continue;
    }
    if (merged.length > 440) {
      merged = truncate(merged, 440);
    }
    windows.push(merged);
  }

  if (windows.length > 0) {
    return windows;
  }

  const fallback = normalizeSentence(text);
  if (!fallback) {
    return [];
  }
  return [truncate(fallback, 440)];
}

function classifyUnitType({ text, heading, isStep }) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return "fact";
  }

  if (isStep || STEP_VERB_PATTERN.test(normalized)) {
    return "step";
  }
  if (CONSTRAINT_PATTERN.test(normalized)) {
    return "constraint";
  }
  if (/\b(definition|overview|concept)\b/i.test(String(heading || "")) || DEFINITION_PATTERN.test(normalized)) {
    return "definition";
  }
  return "fact";
}

function citationIdForUnit(library, version, unit) {
  return `${library}@${version}:${unit.doc_id}#${unit.anchor}:${unit.line_start}-${unit.line_end}`;
}

function collectCodeBlocksWithLines(bodyLines) {
  const blocks = [];
  let inFence = false;
  let startLine = 0;
  let collected = [];

  for (const entry of bodyLines) {
    const rawLine = String(entry.text || "");
    if (rawLine.trim().startsWith("```")) {
      if (inFence) {
        const text = collected.join("\n").trim();
        if (text) {
          blocks.push({
            text,
            line_start: startLine,
            line_end: entry.line
          });
        }
        inFence = false;
        startLine = 0;
        collected = [];
      } else {
        inFence = true;
        startLine = entry.line;
        collected = [];
      }
      continue;
    }

    if (inFence) {
      collected.push(rawLine);
    }
  }

  return blocks;
}

function collectProseBlocks(bodyLines) {
  const output = [];
  let current = null;
  let inFence = false;

  function flush() {
    if (!current || current.lines.length === 0) {
      current = null;
      return;
    }
    output.push(current);
    current = null;
  }

  for (const entry of bodyLines) {
    const raw = String(entry.text || "");
    const trimmed = raw.trim();

    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      flush();
      continue;
    }

    if (inFence) {
      continue;
    }

    if (!trimmed) {
      flush();
      continue;
    }

    const isBullet = /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(raw);
    const normalized = trimmed.replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, "").trim();

    if (!current) {
      current = {
        is_step: isBullet,
        line_start: entry.line,
        line_end: entry.line,
        lines: [normalized]
      };
      continue;
    }

    if (isBullet || current.is_step !== isBullet) {
      flush();
      current = {
        is_step: isBullet,
        line_start: entry.line,
        line_end: entry.line,
        lines: [normalized]
      };
      continue;
    }

    current.lines.push(normalized);
    current.line_end = entry.line;
  }

  flush();
  return output;
}

function collectInlineCommandUnits({ library, version, doc_id, anchor, bodyLines }) {
  const units = [];

  for (const entry of bodyLines) {
    const text = String(entry.text || "");
    const matches = text.match(/`([^`]+)`/g) || [];
    for (const raw of matches) {
      const candidate = raw.slice(1, -1).trim();
      if (!candidate || !isLikelyInlineCommand(candidate)) {
        continue;
      }
      const normalized = truncate(candidate, 440);
      const base = {
        doc_id,
        anchor,
        line_start: entry.line,
        line_end: entry.line
      };
      const unit = {
        ...base,
        unit_id: `unit_${hashText(`${doc_id}|${anchor}|${entry.line}|command|${normalized}`).slice(0, 12)}`,
        type: "command",
        text: normalized,
        keywords: tokenize(normalized),
        token_estimate: tokenEstimate(normalized),
        text_hash: hashText(normalized.toLowerCase())
      };
      unit.citation_id = citationIdForUnit(library, version, unit);
      units.push(unit);
    }
  }

  return units;
}

function isLikelyInlineCommand(value) {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }

  const hasSpace = /\s/.test(text);
  const first = text.split(/\s+/)[0].replace(/^['"]|['"]$/g, "");
  const hasKnownStart = COMMAND_START_PATTERN.test(first);
  const hasOperator = /(\|\||&&|\||>|<|\$\(|;)/.test(text);
  const hasFlag = /(^|\s)--[a-z0-9-]+/.test(text);
  const looksLikeFile = /^[./A-Za-z0-9_-]+\.(json|ya?ml|toml|md|txt|ini|cfg|lock)$/i.test(text);
  const looksLikePathOnly = /^[./A-Za-z0-9_<>-]+\/[A-Za-z0-9_./<>-]+$/.test(text) && !hasSpace;
  if ((looksLikeFile || looksLikePathOnly) && !hasFlag && !hasKnownStart) {
    return false;
  }

  if (hasKnownStart) {
    if (/^trail-docs$/i.test(first) && !hasSpace && !hasFlag && !hasOperator) {
      return false;
    }
    return true;
  }

  if (hasFlag && hasSpace) {
    return true;
  }

  return false;
}

function uniqueUnits(units) {
  const byHash = new Map();
  for (const unit of units) {
    const key = `${unit.doc_id}|${unit.anchor}|${unit.line_start}|${unit.line_end}|${unit.text_hash}|${unit.type}`;
    if (!byHash.has(key)) {
      byHash.set(key, unit);
    }
  }
  return [...byHash.values()].sort((left, right) => {
    if (left.doc_id !== right.doc_id) {
      return left.doc_id.localeCompare(right.doc_id);
    }
    if (left.anchor !== right.anchor) {
      return left.anchor.localeCompare(right.anchor);
    }
    if (left.line_start !== right.line_start) {
      return left.line_start - right.line_start;
    }
    return left.unit_id.localeCompare(right.unit_id);
  });
}

function sectionKeywordsForGraph(evidenceUnitsByRef, ref) {
  const units = evidenceUnitsByRef.get(ref) || [];
  const set = new Set();
  for (const unit of units) {
    for (const token of unit.keywords || []) {
      if (token.length > 2) {
        set.add(token);
      }
    }
  }
  return set;
}

function sectionSymbolsForGraph(section) {
  const set = new Set();
  const text = [
    ...(Array.isArray(section._body_lines) ? section._body_lines.map((entry) => String(entry.text || "")) : []),
    ...(Array.isArray(section.code_blocks) ? section.code_blocks : [])
  ].join("\n");

  const matches = text.match(SYMBOL_PATTERN) || [];
  for (const match of matches) {
    set.add(match.trim());
  }
  return set;
}

function jaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersection += 1;
    }
  }
  const union = setA.size + setB.size - intersection;
  if (union <= 0) {
    return 0;
  }
  return intersection / union;
}

function resolveRefLink(sectionDocId, linkTarget) {
  const raw = String(linkTarget || "").trim();
  if (!raw || /^https?:\/\//i.test(raw)) {
    return "";
  }

  if (raw.startsWith("#")) {
    const anchor = normalizeAnchor(raw.slice(1));
    return `${sectionDocId}#${anchor}`;
  }

  const hashIndex = raw.indexOf("#");
  if (hashIndex >= 0) {
    const doc = raw.slice(0, hashIndex).replace(/\.md$/i, "").replace(/\/index$/i, "") || sectionDocId;
    const anchor = normalizeAnchor(raw.slice(hashIndex + 1));
    return `${doc}#${anchor}`;
  }

  if (/\.md$/i.test(raw)) {
    const doc = raw.replace(/\.md$/i, "").replace(/\/index$/i, "") || "readme";
    return `${doc}#document`;
  }

  return "";
}

export function extractEvidenceUnits({ library, version, sections }) {
  const collected = [];

  for (const section of sections) {
    const bodyLines = Array.isArray(section._body_lines) ? section._body_lines : [];
    const base = {
      doc_id: section.doc_id,
      anchor: section.anchor
    };

    const codeBlocks = collectCodeBlocksWithLines(bodyLines);
    for (const block of codeBlocks) {
      const text = truncate(String(block.text || "").trim(), 440);
      if (!text) {
        continue;
      }
      const unit = {
        ...base,
        line_start: block.line_start,
        line_end: block.line_end,
        unit_id: `unit_${hashText(`${section.doc_id}|${section.anchor}|${block.line_start}|command|${text}`).slice(0, 12)}`,
        type: "command",
        text,
        keywords: tokenize(text),
        token_estimate: tokenEstimate(text),
        text_hash: hashText(text.toLowerCase())
      };
      unit.citation_id = citationIdForUnit(library, version, unit);
      collected.push(unit);
    }

    const proseBlocks = collectProseBlocks(bodyLines);
    for (const block of proseBlocks) {
      const merged = block.lines.join(" ").trim();
      if (!merged) {
        continue;
      }

      const windows = splitIntoSentenceWindows(merged);
      for (const windowText of windows) {
        const type = classifyUnitType({
          text: windowText,
          heading: section.heading,
          isStep: block.is_step
        });
        const unit = {
          ...base,
          line_start: block.line_start,
          line_end: block.line_end,
          unit_id: `unit_${hashText(`${section.doc_id}|${section.anchor}|${block.line_start}|${type}|${windowText}`).slice(0, 12)}`,
          type,
          text: windowText,
          keywords: tokenize(windowText),
          token_estimate: tokenEstimate(windowText),
          text_hash: hashText(windowText.toLowerCase())
        };
        unit.citation_id = citationIdForUnit(library, version, unit);
        collected.push(unit);
      }
    }

    collected.push(...collectInlineCommandUnits({
      library,
      version,
      doc_id: section.doc_id,
      anchor: section.anchor,
      bodyLines
    }));
  }

  return uniqueUnits(collected);
}

export function buildAnchorGraph({ sections, evidenceUnits }) {
  const sectionsSorted = [...sections].sort((left, right) => {
    if (left.doc_id !== right.doc_id) {
      return left.doc_id.localeCompare(right.doc_id);
    }
    return left.line_start - right.line_start;
  });

  const refs = sectionsSorted.map((section) => `${section.doc_id}#${section.anchor}`);
  const byRef = new Map();
  for (const section of sectionsSorted) {
    byRef.set(`${section.doc_id}#${section.anchor}`, section);
  }

  const evidenceByRef = new Map();
  for (const unit of evidenceUnits || []) {
    const ref = `${unit.doc_id}#${unit.anchor}`;
    if (!evidenceByRef.has(ref)) {
      evidenceByRef.set(ref, []);
    }
    evidenceByRef.get(ref).push(unit);
  }

  const keywordSets = new Map();
  const symbolSets = new Map();
  for (const ref of refs) {
    keywordSets.set(ref, sectionKeywordsForGraph(evidenceByRef, ref));
    symbolSets.set(ref, sectionSymbolsForGraph(byRef.get(ref)));
  }

  const output = [];
  for (let index = 0; index < sectionsSorted.length; index += 1) {
    const section = sectionsSorted[index];
    const ref = `${section.doc_id}#${section.anchor}`;

    const previous = index > 0 && sectionsSorted[index - 1].doc_id === section.doc_id
      ? `${sectionsSorted[index - 1].doc_id}#${sectionsSorted[index - 1].anchor}`
      : "";
    const next = index < sectionsSorted.length - 1 && sectionsSorted[index + 1].doc_id === section.doc_id
      ? `${sectionsSorted[index + 1].doc_id}#${sectionsSorted[index + 1].anchor}`
      : "";

    const intraDocLinks = [];
    for (const line of section._body_lines || []) {
      const matches = String(line.text || "").match(/\[[^\]]+\]\(([^)]+)\)/g) || [];
      for (const raw of matches) {
        const target = raw.match(/\(([^)]+)\)/)?.[1] || "";
        const resolved = resolveRefLink(section.doc_id, target);
        if (resolved) {
          intraDocLinks.push(resolved);
        }
      }
    }

    const keywordOverlapRefs = refs
      .filter((candidate) => candidate !== ref)
      .map((candidate) => ({
        ref: candidate,
        score: jaccard(keywordSets.get(ref), keywordSets.get(candidate))
      }))
      .filter((entry) => entry.score >= 0.2)
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }
        return left.ref.localeCompare(right.ref);
      })
      .slice(0, 5)
      .map((entry) => entry.ref);

    const symbolOverlapRefs = refs
      .filter((candidate) => candidate !== ref)
      .map((candidate) => ({
        ref: candidate,
        score: jaccard(symbolSets.get(ref), symbolSets.get(candidate))
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }
        return left.ref.localeCompare(right.ref);
      })
      .slice(0, 5)
      .map((entry) => entry.ref);

    output.push({
      ref,
      heading_prev: previous,
      heading_next: next,
      intra_doc_links: [...new Set(intraDocLinks)].sort((a, b) => a.localeCompare(b)),
      keyword_overlap_refs: keywordOverlapRefs,
      symbol_overlap_refs: symbolOverlapRefs
    });
  }

  return output;
}

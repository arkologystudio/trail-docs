const TOKEN_RE = /[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g;

export function tokenizeText(value) {
  const text = String(value || "");
  return text.match(TOKEN_RE) || [];
}

export function countTokens(value) {
  return tokenizeText(value).length;
}

export function countBlocksTokens(blocks) {
  if (!Array.isArray(blocks)) {
    return 0;
  }
  let total = 0;
  for (const block of blocks) {
    total += countTokens(block?.text || "");
    total += countTokens(block?.citation || "");
  }
  return total;
}

export function trimBlocksToTokenBudget(blocks, maxTokens) {
  const safeMax = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : 0;
  if (!Array.isArray(blocks) || safeMax <= 0) {
    return [];
  }

  const output = [];
  let used = 0;

  for (const block of blocks) {
    const text = String(block?.text || "").trim();
    const citation = String(block?.citation || "").trim();
    if (!text) {
      continue;
    }

    const full = citation ? `${text}\n[citation] ${citation}` : text;
    const fullTokens = countTokens(full);

    if (used + fullTokens <= safeMax) {
      output.push({ text, citation });
      used += fullTokens;
      continue;
    }

    const remaining = safeMax - used;
    if (remaining <= 0) {
      break;
    }

    const partialTokens = tokenizeText(text).slice(0, Math.max(8, remaining - 8));
    const partialText = partialTokens.join(" ").trim();
    if (!partialText) {
      break;
    }

    output.push({ text: `${partialText} ...`, citation });
    used = safeMax;
    break;
  }

  return output;
}

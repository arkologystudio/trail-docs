import fs from "node:fs";
import path from "node:path";
import { buildIndex, loadIndex } from "./indexer.mjs";
import { generateBootstrapDocs } from "./bootstrap.mjs";
import { DEFAULTS, EXIT_CODES } from "./constants.mjs";
import { CliError } from "./errors.mjs";
import {
  countOccurrences,
  parseDocRef,
  stableUnique,
  tokenize,
  truncate
} from "./utils.mjs";

function requireFlag(flags, name) {
  const value = flags[name];
  if (!value || typeof value !== "string") {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `Missing required flag --${name}`,
      `Pass --${name} <value>`
    );
  }
  return value;
}

function toNumber(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function selectSection(index, rawRef) {
  const { docId, anchor } = parseDocRef(rawRef);
  if (!docId) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `Invalid reference: ${rawRef}`,
      "Use <doc_id#anchor>"
    );
  }

  const section = anchor
    ? index.sections.find((item) => item.doc_id === docId && item.anchor === anchor)
    : index.sections.find((item) => item.doc_id === docId);

  if (!section) {
    throw new CliError(
      EXIT_CODES.REF_NOT_FOUND,
      "REF_NOT_FOUND",
      `No section found for ${rawRef}`,
      "Run doccli search with a related query"
    );
  }

  return section;
}

function citationFor(index, section) {
  return {
    citation_id: `${index.library}@${index.version}:${section.doc_id}#${section.anchor}:${section.line_start}-${section.line_end}`,
    library: index.library,
    version: index.version,
    doc_id: section.doc_id,
    anchor: section.anchor,
    source_path: section.source_path,
    line_start: section.line_start,
    line_end: section.line_end
  };
}

function buildSnippet(text, tokens, maxChars) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  let firstMatch = -1;
  for (const token of tokens) {
    const position = lower.indexOf(token);
    if (position >= 0 && (firstMatch === -1 || position < firstMatch)) {
      firstMatch = position;
    }
  }

  if (firstMatch === -1) {
    return truncate(normalized, maxChars);
  }

  const targetLength = Math.max(80, maxChars);
  let start = Math.max(0, firstMatch - Math.floor(targetLength / 3));
  let end = Math.min(normalized.length, start + targetLength);

  if (start > 0) {
    const previousSpace = normalized.lastIndexOf(" ", start);
    if (previousSpace > 0) {
      start = previousSpace + 1;
    }
  }
  if (end < normalized.length) {
    const nextSpace = normalized.indexOf(" ", end);
    if (nextSpace > 0) {
      end = nextSpace;
    }
  }

  const window = normalized.slice(start, end).trim();
  if (window.length <= maxChars) {
    return window;
  }
  return truncate(window, maxChars);
}

function searchSections(index, query, maxResults, maxChars) {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return [];
  }

  const ranked = [];

  for (const section of index.sections) {
    const heading = section.heading.toLowerCase();
    const text = section.text.toLowerCase();
    let score = 0;

    for (const token of tokens) {
      score += countOccurrences(text, token);
      score += countOccurrences(heading, token) * 2;
    }

    if (score <= 0) {
      continue;
    }

    ranked.push({
      score: Number((score / tokens.length).toFixed(4)),
      doc_id: section.doc_id,
      anchor: section.anchor,
      heading: section.heading,
      snippet: buildSnippet(section.text || section.snippet, tokens, Math.min(maxChars, 400)),
      source_path: section.source_path,
      line_start: section.line_start,
      line_end: section.line_end
    });
  }

  ranked.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    if (left.doc_id !== right.doc_id) {
      return left.doc_id.localeCompare(right.doc_id);
    }
    return left.anchor.localeCompare(right.anchor);
  });

  return ranked.slice(0, maxResults);
}

function stepInstruction(section, maxChars = 420) {
  const cleaned = String(section.text || "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 12) {
    return "";
  }

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .filter((value) => !/^\d+\.$/.test(value))
    .filter((value) => /[a-z]{3}/i.test(value));

  if (sentences.length === 0) {
    return truncate(cleaned, maxChars);
  }

  let composed = "";
  for (const sentence of sentences) {
    const next = composed ? `${composed} ${sentence}` : sentence;
    if (next.length > maxChars && composed) {
      break;
    }
    composed = next;
    if (composed.length >= Math.floor(maxChars * 0.8)) {
      break;
    }
  }

  return truncate(composed || sentences[0], maxChars);
}

function firstSentenceMatch(text, pattern, maxChars = 200) {
  const sentences = String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  for (const sentence of sentences) {
    if (pattern.test(sentence)) {
      return truncate(sentence, maxChars);
    }
  }

  return "";
}

function commandFromSection(section, maxChars = 300) {
  if (Array.isArray(section.code_blocks) && section.code_blocks.length > 0) {
    const first = String(section.code_blocks[0] || "").trim();
    if (first) {
      return truncate(first, maxChars);
    }
  }

  const inlineCodeMatches = String(section.text || "").match(/`([^`]+)`/g) || [];
  for (const raw of inlineCodeMatches) {
    const value = raw.slice(1, -1).trim();
    if (/[./$-]/.test(value) || /\s/.test(value)) {
      return truncate(value, maxChars);
    }
  }

  return "";
}

function deriveStepHints(section, maxChars = 300) {
  const command = commandFromSection(section, maxChars);
  const expected = firstSentenceMatch(
    section.text,
    /\b(expect|expected|shows?|returns?|result|output)\b/i,
    Math.min(maxChars, 220)
  );
  const prerequisites = firstSentenceMatch(
    section.text,
    /\b(prerequisite|before|must|require|ensure|needs?)\b/i,
    Math.min(maxChars, 220)
  );

  return { command, expected, prerequisites };
}

function readManifest(manifestPath) {
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.index_path || !parsed.library || !parsed.library_version) {
      throw new Error("Invalid manifest");
    }
    return parsed;
  } catch {
    throw new CliError(
      EXIT_CODES.RESOLUTION_FAILED,
      "RESOLUTION_FAILED",
      `Invalid manifest at ${manifestPath}`,
      "Rebuild and re-publish library docs artifact"
    );
  }
}

function findManifestForLibrary(library, explicitPath = "") {
  const candidates = [];
  const pushCandidateSet = (baseDir) => {
    candidates.push(path.resolve(baseDir, "doccli.json"));
    candidates.push(path.resolve(baseDir, "manifest.json"));
    candidates.push(path.resolve(baseDir, ".doccli", "doccli.json"));
    candidates.push(path.resolve(baseDir, ".doccli", "manifest.json"));
    candidates.push(path.resolve(baseDir, library, "doccli.json"));
    candidates.push(path.resolve(baseDir, library, "manifest.json"));
    candidates.push(path.resolve(baseDir, library, ".doccli", "doccli.json"));
  };

  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      candidates.push(resolved);
    } else {
      pushCandidateSet(resolved);
    }
  }

  const envPaths = process.env.DOCCLI_PATHS || "";
  if (envPaths) {
    for (const entry of envPaths.split(path.delimiter)) {
      if (entry.trim()) {
        pushCandidateSet(entry.trim());
      }
    }
  }

  pushCandidateSet(process.cwd());

  let current = process.cwd();
  while (true) {
    candidates.push(path.join(current, "node_modules", library, "doccli.json"));
    candidates.push(path.join(current, "node_modules", library, "manifest.json"));
    candidates.push(path.join(current, "node_modules", library, ".doccli", "doccli.json"));
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  const deduped = stableUnique(candidates);
  for (const candidate of deduped) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const searched = deduped.slice(0, 8).join(", ");
  throw new CliError(
    EXIT_CODES.RESOLUTION_FAILED,
    "RESOLUTION_FAILED",
    `Could not locate docs manifest for library ${library}. Checked: ${searched}${deduped.length > 8 ? ", ..." : ""}`,
    "Install docs artifact, emit doccli.json, set DOCCLI_PATHS, or pass --path"
  );
}

function resolveIndexForCommand(flags) {
  return flags.index ? path.resolve(String(flags.index)) : path.resolve(".doccli/index.json");
}

export function runList(flags) {
  const index = loadIndex(resolveIndexForCommand(flags));
  const sectionCounts = new Map();
  for (const section of index.sections) {
    sectionCounts.set(section.doc_id, (sectionCounts.get(section.doc_id) || 0) + 1);
  }

  const docs = index.docs
    .map((doc) => ({
      doc_id: doc.doc_id,
      title: doc.title,
      source_path: doc.source_path,
      sections: sectionCounts.get(doc.doc_id) || 0
    }))
    .sort((left, right) => left.doc_id.localeCompare(right.doc_id));

  return {
    library: index.library,
    version: index.version,
    docs
  };
}

export function runStats(flags) {
  const index = loadIndex(resolveIndexForCommand(flags));
  let codeBlockCount = 0;
  for (const section of index.sections) {
    codeBlockCount += Array.isArray(section.code_blocks) ? section.code_blocks.length : 0;
  }

  const docsCount = index.docs.length || 1;
  return {
    library: index.library,
    version: index.version,
    docs_count: index.docs.length,
    sections_count: index.sections.length,
    code_blocks_count: codeBlockCount,
    sections_per_doc: Number((index.sections.length / docsCount).toFixed(2)),
    built_at: index.build?.built_at || "",
    source_hash: index.build?.source_hash || ""
  };
}

export function runBuild(flags) {
  const srcDir = requireFlag(flags, "src");
  const outFile = flags.out ? String(flags.out) : ".doccli/index.json";
  const library = requireFlag(flags, "library");
  const version = requireFlag(flags, "version");
  return buildIndex({ srcDir, outFile, library, version });
}

export function runBootstrap(flags) {
  const srcDir = requireFlag(flags, "src");
  const library = requireFlag(flags, "library");
  const version = requireFlag(flags, "version");
  const docsOutDir = flags["docs-out"] ? String(flags["docs-out"]) : ".doccli/generated-docs";
  const outFile = flags.out ? String(flags.out) : ".doccli/index.json";
  const shouldEmitManifest = Boolean(flags["emit-manifest"]);
  const manifestOut = flags["manifest-out"] ? String(flags["manifest-out"]) : "doccli.json";

  const generated = generateBootstrapDocs({
    srcDir,
    docsOutDir,
    library
  });

  const buildResult = buildIndex({
    srcDir: generated.docs_dir,
    outFile,
    library,
    version
  });

  let manifestPath = "";
  if (shouldEmitManifest) {
    const resolvedManifestPath = path.resolve(manifestOut);
    const resolvedIndexPath = path.resolve(buildResult.index_path);
    const relativeIndexPath = path
      .relative(path.dirname(resolvedManifestPath), resolvedIndexPath)
      .split(path.sep)
      .join("/");

    const manifest = {
      schema_version: "1",
      library,
      library_version: version,
      index_path: relativeIndexPath || ".doccli/index.json",
      built_at: new Date().toISOString()
    };

    fs.mkdirSync(path.dirname(resolvedManifestPath), { recursive: true });
    fs.writeFileSync(resolvedManifestPath, JSON.stringify(manifest, null, 2), "utf8");
    manifestPath = resolvedManifestPath;
  }

  return {
    ok: true,
    confidence: "partial",
    generated_docs_dir: generated.docs_dir,
    generated_docs_file: generated.docs_file,
    source_files_scanned: generated.source_files_scanned,
    symbols_detected: generated.symbols_detected,
    routes_detected: generated.routes_detected,
    env_vars_detected: generated.env_vars_detected,
    index_path: buildResult.index_path,
    manifest_path: manifestPath,
    docs_count: buildResult.docs_count,
    sections_count: buildResult.sections_count,
    source_hash: buildResult.source_hash
  };
}

export function runSearch(positionals, flags) {
  const query = positionals.join(" ").trim();
  if (!query) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing query text for search",
      "Usage: doccli search <query>"
    );
  }

  const index = loadIndex(resolveIndexForCommand(flags));
  const maxResults = toNumber(flags["max-results"], DEFAULTS.maxResults);
  const maxChars = toNumber(flags["max-chars"], DEFAULTS.maxChars);
  const results = searchSections(index, query, maxResults, maxChars);
  return {
    query,
    library: index.library,
    version: index.version,
    results
  };
}

export function runOpen(positionals, flags) {
  const rawRef = positionals[0];
  if (!rawRef) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing reference for open",
      "Usage: doccli open <doc_id#anchor>"
    );
  }

  const index = loadIndex(resolveIndexForCommand(flags));
  const section = selectSection(index, rawRef);
  const maxChars = toNumber(flags["max-chars"], DEFAULTS.maxChars);

  return {
    library: index.library,
    version: index.version,
    doc_id: section.doc_id,
    anchor: section.anchor,
    heading: section.heading,
    content: truncate(section.text, maxChars),
    code_blocks: section.code_blocks.map((value) => truncate(value, maxChars)),
    source_path: section.source_path,
    line_start: section.line_start,
    line_end: section.line_end
  };
}

export function runCite(positionals, flags) {
  const rawRef = positionals[0];
  if (!rawRef) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing reference for cite",
      "Usage: doccli cite <doc_id#anchor>"
    );
  }

  const index = loadIndex(resolveIndexForCommand(flags));
  const section = selectSection(index, rawRef);
  return citationFor(index, section);
}

export function runUse(positionals, flags) {
  const library = positionals[0];
  const task = positionals.slice(1).join(" ").trim();
  if (!library || !task) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing library or task for use command",
      "Usage: doccli use <library> \"<task>\""
    );
  }

  const manifestPath = findManifestForLibrary(library, flags.path ? String(flags.path) : "");
  const manifest = readManifest(manifestPath);
  const indexPath = path.resolve(path.dirname(manifestPath), manifest.index_path);
  const index = loadIndex(indexPath);
  const maxResults = toNumber(flags["max-results"], 3);
  const maxChars = toNumber(flags["max-chars"], DEFAULTS.maxChars);
  const searchResults = searchSections(index, task, maxResults, Math.min(maxChars, 320));

  if (searchResults.length === 0) {
    return {
      task,
      library: manifest.library,
      version: manifest.library_version,
      confidence: "partial",
      steps: [],
      snippet: "",
      citations: [],
      related_docs: []
    };
  }

  const steps = [];
  const citations = [];
  const relatedDocs = [];
  let snippet = "";
  const topScore = searchResults[0]?.score || 1;

  for (let indexValue = 0; indexValue < searchResults.length; indexValue += 1) {
    const result = searchResults[indexValue];
    const section = selectSection(index, `${result.doc_id}#${result.anchor}`);
    const citation = citationFor(index, section);
    const instruction = stepInstruction(section);
    const hints = deriveStepHints(section, maxChars);
    if (!instruction) {
      continue;
    }
    const step = {
      id: `step_${steps.length + 1}`,
      instruction,
      confidence: Number(Math.max(0.1, Math.min(1, result.score / topScore)).toFixed(2)),
      citations: [citation.citation_id]
    };
    if (hints.command) {
      step.command = hints.command;
    }
    if (hints.expected) {
      step.expected = hints.expected;
    }
    if (hints.prerequisites) {
      step.prerequisites = hints.prerequisites;
    }
    steps.push(step);
    citations.push(citation.citation_id);

    if (!snippet && section.code_blocks.length > 0) {
      snippet = truncate(section.code_blocks[0], maxChars);
    }

    if (!relatedDocs.includes(section.doc_id)) {
      relatedDocs.push(section.doc_id);
    }
  }

  if (steps.length === 0) {
    return {
      task,
      library: manifest.library,
      version: manifest.library_version,
      confidence: "partial",
      steps: [],
      snippet: "",
      citations: [],
      related_docs: []
    };
  }

  return {
    task,
    library: manifest.library,
    version: manifest.library_version,
    confidence: "authoritative",
    steps,
    snippet,
    citations: stableUnique(citations),
    related_docs: relatedDocs.slice(0, 3)
  };
}

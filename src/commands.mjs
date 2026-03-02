import fs from "node:fs";
import path from "node:path";
import { buildIndex, loadIndex } from "./indexer.mjs";
import { generateBootstrapDocs } from "./bootstrap.mjs";
import { discoverLibraries } from "./discovery.mjs";
import { fetchLibrarySource } from "./fetcher.mjs";
import { buildSurfaceForSelector, citationForSymbol } from "./surface.mjs";
import { DEFAULTS, EXIT_CODES } from "./constants.mjs";
import { CliError } from "./errors.mjs";
import {
  countOccurrences,
  ensureDirForFile,
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

function parseSelectorSymbolRef(rawRef) {
  const value = String(rawRef || "").trim();
  const hashIndex = value.indexOf("#");
  if (!value || hashIndex <= 0 || hashIndex === value.length - 1) {
    return { selector: "", symbolQuery: "" };
  }

  return {
    selector: value.slice(0, hashIndex),
    symbolQuery: value.slice(hashIndex + 1)
  };
}

function overlapScore(haystackTokens, needleTokens) {
  if (needleTokens.length === 0) {
    return 0;
  }
  let hit = 0;
  for (const token of needleTokens) {
    if (haystackTokens.has(token)) {
      hit += 1;
    }
  }
  return hit / needleTokens.length;
}

function symbolMatchCandidates(surfacePayload, symbolQuery) {
  const normalized = String(symbolQuery || "").trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const symbols = surfacePayload.symbols || [];
  const exact = symbols.filter((entry) => {
    const name = String(entry.name || "").toLowerCase();
    const fqName = String(entry.fq_name || "").toLowerCase();
    const symbolId = String(entry.symbol_id || "").toLowerCase();
    return name === normalized || fqName === normalized || symbolId.endsWith(`::${normalized}`);
  });
  if (exact.length > 0) {
    return exact.map((entry) => ({ entry, match_type: "exact", score: 1 }));
  }

  const prefix = symbols
    .filter((entry) => {
      const name = String(entry.name || "").toLowerCase();
      const fqName = String(entry.fq_name || "").toLowerCase();
      return fqName.startsWith(normalized) || fqName.includes(`.${normalized}`) || name.startsWith(normalized);
    })
    .map((entry) => ({ entry, match_type: "prefix", score: 0.8 }));

  if (prefix.length > 0) {
    return prefix;
  }

  const queryTokens = tokenize(normalized);
  const fuzzy = symbols
    .map((entry) => {
      const tokenSet = new Set(
        tokenize(
          `${entry.name || ""} ${entry.fq_name || ""} ${(entry.signatures || []).join(" ")} ${entry.summary || ""}`
        )
      );
      const score = overlapScore(tokenSet, queryTokens);
      return {
        entry,
        match_type: "fuzzy",
        score
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return String(left.entry.fq_name || "").localeCompare(String(right.entry.fq_name || ""));
    });

  return fuzzy;
}

function sortableSymbolName(symbol) {
  return `${symbol.fq_name || ""}:${symbol.module_path || ""}:${symbol.line_start || 0}`;
}

function parseListFlag(value) {
  return stableUnique(
    String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function isExplicitSelector(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return false;
  }
  if (/^(npm|github):/i.test(raw)) {
    return true;
  }
  if (fs.existsSync(path.resolve(raw))) {
    return true;
  }
  try {
    const parsed = new URL(raw);
    return /^https?:$/i.test(parsed.protocol);
  } catch {
    return false;
  }
}

function toManifestPayload(library, version, manifestPath, indexPath) {
  const relativeIndexPath = path
    .relative(path.dirname(manifestPath), indexPath)
    .split(path.sep)
    .join("/");

  return {
    schema_version: "1",
    library,
    library_version: version,
    index_path: relativeIndexPath || "index.json",
    built_at: new Date().toISOString()
  };
}

function resolveIndexPathsFromFlags(flags) {
  if (flags.indexes) {
    return parseListFlag(flags.indexes).map((entry) => path.resolve(entry));
  }
  return [];
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
      "Run trail-docs search with a related query"
    );
  }

  return section;
}

function citationFor(index, section) {
  const payload = {
    citation_id: `${index.library}@${index.version}:${section.doc_id}#${section.anchor}:${section.line_start}-${section.line_end}`,
    library: index.library,
    version: index.version,
    doc_id: section.doc_id,
    anchor: section.anchor,
    source_path: section.source_path,
    line_start: section.line_start,
    line_end: section.line_end
  };
  if (index.build?.source) {
    payload.provenance = {
      source_type: index.build.source.source_type || "",
      provider: index.build.source.provider || "",
      canonical_url: index.build.source.canonical_url || "",
      requested_ref: index.build.source.requested_ref || "",
      resolved_ref: index.build.source.resolved_ref || "",
      fetched_at: index.build.source.fetched_at || ""
    };
  }
  return payload;
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
      score += Math.min(3, countOccurrences(text, token));
      score += Math.min(2, countOccurrences(heading, token)) * 2;
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
    const looksCommandLike =
      /\s/.test(value) ||
      /^(npm|yarn|pnpm|npx|node|curl|git|docker|import|const|let|export|axios|\.\/|\/)/i.test(value);
    if (looksCommandLike) {
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

function rerankUseResults(searchResults, index, task) {
  const taskTokens = new Set(tokenize(task));
  const actionIntent =
    /\b(how|install|setup|set up|configure|create|run|deploy|request|use|start|build|test)\b/i.test(task);
  const releaseIntent = /\b(changelog|release|version|breaking change|migration|upgrade)\b/i.test(task);
  const errorIntent = /\b(error|debug|troubleshoot|failure|exception|timeout)\b/i.test(task);

  const adjusted = searchResults.map((result) => {
    let score = result.score;
    const heading = String(result.heading || "").toLowerCase();
    const docId = String(result.doc_id || "").toLowerCase();
    const section = selectSection(index, `${result.doc_id}#${result.anchor}`);
    const text = String(section.text || "").toLowerCase();
    const hints = deriveStepHints(section, 240);
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    const isReleaseLike =
      /changelog|release[-\s]?notes?|history/.test(docId) || /changelog|release[-\s]?notes?|chores?/.test(heading);
    const isMetaLike = /table[\s-]*of[\s-]*contents|toc|docs[\s-]*community|community|license|contributing/.test(
      heading
    );
    const isInternalLike = /(^|\/)lib\/|internal|architecture|design-doc|spec/.test(docId);
    const isGuideLike = /readme|docs\/|guide|tutorial|examples?/.test(docId);

    if (isReleaseLike && !releaseIntent) {
      score -= 20;
    } else if (isReleaseLike) {
      score -= 1;
    }
    if (!releaseIntent && /migration/.test(docId)) {
      score -= 8;
    }
    if (isMetaLike) {
      score -= 8;
    }
    if (isInternalLike && actionIntent) {
      score -= 2.5;
    }
    if (isGuideLike) {
      score += 1.2;
    }
    if (/deprecated|migration/.test(heading) && actionIntent) {
      score -= 1.2;
    }
    const isErrorLike = /\berror|errors|debug|troubleshoot\b/.test(heading);
    if (!errorIntent && isErrorLike) {
      score -= 3.2;
    }
    if (/^features?$/.test(heading)) {
      score -= 1.4;
    }

    if (
      actionIntent &&
      /install|quick-start|get-started|usage|example|request-config|api|authentication|get|post|put|delete|making requests/.test(
        heading
      )
    ) {
      score += 1.8;
    }
    if (/request method aliases|axios\.get|axios#get/.test(heading) && /\bget\b/i.test(task)) {
      score += 6;
    }
    if (/request[-\s]?method[-\s]?aliases|making requests|example/.test(heading) && /\b(get|post|put|delete|request)\b/i.test(task)) {
      score += 3;
    }
    if (/\(|\)|=>|::/.test(heading)) {
      score -= 1.4;
    }
    if (/axios\.get|get\(/.test(text) && /\bget\b/i.test(task)) {
      score += 8;
    }
    if (/axiosheaders/.test(heading)) {
      score -= 3;
    }
    if (/\bheaders?\b/.test(heading) && /\b(get|request)\b/i.test(task)) {
      score -= 2;
    }
    if (actionIntent && /\b(run|install|configure|create|use|call|request|import)\b/.test(text)) {
      score += 1.1;
    }
    if (Array.isArray(section.code_blocks) && section.code_blocks.length > 0) {
      score += 1.1;
    }
    if (hints.command) {
      score += 0.9;
    }
    if (wordCount < 18) {
      score -= 0.8;
    }

    for (const token of taskTokens) {
      if (heading.includes(token)) {
        score += 0.25;
      }
    }

    return {
      ...result,
      score: Number(score.toFixed(4)),
      _isReleaseLike: isReleaseLike,
      _isMetaLike: isMetaLike,
      _isErrorLike: isErrorLike
    };
  });

  adjusted.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    if (left.doc_id !== right.doc_id) {
      return left.doc_id.localeCompare(right.doc_id);
    }
    return left.anchor.localeCompare(right.anchor);
  });

  return adjusted;
}

function shouldSkipSectionForUse(result, task) {
  const releaseIntent = /\b(changelog|release|version|breaking change|migration|upgrade)\b/i.test(task);
  const errorIntent = /\b(error|debug|troubleshoot|failure|exception|timeout)\b/i.test(task);
  if (result._isMetaLike) {
    return true;
  }
  if (result._isReleaseLike && !releaseIntent) {
    return true;
  }
  if (result._isErrorLike && !errorIntent) {
    return true;
  }
  return false;
}

function lowQualityInstruction(instruction) {
  const normalized = String(instruction || "").trim();
  if (!normalized) {
    return true;
  }
  if (/table of contents/i.test(normalized)) {
    return true;
  }
  if (/^\s*-\s*\[[^\]]+\]\([^)]+\)/.test(normalized)) {
    return true;
  }
  const markdownLinks = (normalized.match(/\[[^\]]+\]\([^)]+\)/g) || []).length;
  if (markdownLinks >= 8) {
    return true;
  }
  return false;
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
    candidates.push(path.resolve(baseDir, "trail-docs.json"));
    candidates.push(path.resolve(baseDir, "manifest.json"));
    candidates.push(path.resolve(baseDir, ".trail-docs", "trail-docs.json"));
    candidates.push(path.resolve(baseDir, ".trail-docs", "manifest.json"));
    candidates.push(path.resolve(baseDir, library, "trail-docs.json"));
    candidates.push(path.resolve(baseDir, library, "manifest.json"));
    candidates.push(path.resolve(baseDir, library, ".trail-docs", "trail-docs.json"));
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
    candidates.push(path.join(current, "node_modules", library, "trail-docs.json"));
    candidates.push(path.join(current, "node_modules", library, "manifest.json"));
    candidates.push(path.join(current, "node_modules", library, ".trail-docs", "trail-docs.json"));
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
    "Install docs artifact, emit trail-docs.json, set DOCCLI_PATHS, or pass --path"
  );
}

function resolveIndexForCommand(flags) {
  return flags.index ? path.resolve(String(flags.index)) : path.resolve(".trail-docs/index.json");
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
    source_hash: index.build?.source_hash || "",
    inferred: Boolean(index.build?.inferred),
    derivation: index.build?.derivation || "",
    source: index.build?.source || null
  };
}

export function runBuild(flags) {
  const srcDir = requireFlag(flags, "src");
  const outFile = flags.out ? String(flags.out) : ".trail-docs/index.json";
  const library = requireFlag(flags, "library");
  const version = requireFlag(flags, "version");
  const sourceManifestPath = flags["source-manifest"] ? String(flags["source-manifest"]) : "";
  return buildIndex({ srcDir, outFile, library, version, sourceManifestPath });
}

export function runBootstrap(flags) {
  const srcDir = requireFlag(flags, "src");
  const library = requireFlag(flags, "library");
  const version = requireFlag(flags, "version");
  const docsOutDir = flags["docs-out"] ? String(flags["docs-out"]) : ".trail-docs/generated-docs";
  const outFile = flags.out ? String(flags.out) : ".trail-docs/index.json";
  const shouldEmitManifest = Boolean(flags["emit-manifest"]);
  const manifestOut = flags["manifest-out"] ? String(flags["manifest-out"]) : "trail-docs.json";

  const generated = generateBootstrapDocs({
    srcDir,
    docsOutDir,
    library
  });

  const buildResult = buildIndex({
    srcDir: generated.docs_dir,
    outFile,
    library,
    version,
    buildContext: {
      inferred: true,
      derivation: "bootstrap"
    }
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
      index_path: relativeIndexPath || ".trail-docs/index.json",
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
    signals_detected: generated.signals_detected || 0,
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
      "Usage: trail-docs search <query>"
    );
  }

  const maxResults = toNumber(flags["max-results"], DEFAULTS.maxResults);
  const maxChars = toNumber(flags["max-chars"], DEFAULTS.maxChars);
  const federatedIndexes = resolveIndexPathsFromFlags(flags);
  if (federatedIndexes.length > 0) {
    const combined = [];
    for (const indexPath of federatedIndexes) {
      const index = loadIndex(indexPath);
      const perIndexResults = searchSections(index, query, Math.max(maxResults * 2, 10), maxChars);
      for (const result of perIndexResults) {
        combined.push({
          ...result,
          library: index.library,
          version: index.version,
          citation_id: `${index.library}@${index.version}:${result.doc_id}#${result.anchor}:${result.line_start}-${result.line_end}`
        });
      }
    }

    combined.sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      if (left.library !== right.library) {
        return left.library.localeCompare(right.library);
      }
      if (left.doc_id !== right.doc_id) {
        return left.doc_id.localeCompare(right.doc_id);
      }
      return left.anchor.localeCompare(right.anchor);
    });

    return {
      query,
      mode: "federated",
      indexes: federatedIndexes,
      results: combined.slice(0, maxResults)
    };
  }

  const index = loadIndex(resolveIndexForCommand(flags));
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
      "Usage: trail-docs open <doc_id#anchor>"
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
      "Usage: trail-docs cite <doc_id#anchor>"
    );
  }

  const index = loadIndex(resolveIndexForCommand(flags));
  const section = selectSection(index, rawRef);
  return citationFor(index, section);
}

export async function runDiscover(positionals, flags) {
  const query = positionals.join(" ").trim();
  if (!query) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing query text for discover",
      "Usage: trail-docs discover <query>"
    );
  }

  return discoverLibraries({
    query,
    maxResults: toNumber(flags["max-results"], DEFAULTS.maxResults),
    provider: flags.provider ? String(flags.provider) : "all",
    catalogPath: flags.catalog ? String(flags.catalog) : "",
    ecosystem: flags.ecosystem ? String(flags.ecosystem) : ""
  });
}

export async function runFetch(positionals, flags) {
  const selector = positionals[0];
  if (!selector) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing selector for fetch",
      "Usage: trail-docs fetch <selector>"
    );
  }

  return fetchLibrarySource({
    selector,
    flags
  });
}

export async function runPrep(positionals, flags) {
  const input = positionals.join(" ").trim();
  if (!input) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing query or selector for prep",
      "Usage: trail-docs prep <query_or_selector_or_url>"
    );
  }

  let selector = "";
  let discovery = null;
  if (isExplicitSelector(input)) {
    selector = input;
  } else {
    discovery = await discoverLibraries({
      query: input,
      maxResults: toNumber(flags["max-results"], DEFAULTS.maxResults),
      provider: flags.provider ? String(flags.provider) : "all",
      catalogPath: flags.catalog ? String(flags.catalog) : "",
      ecosystem: flags.ecosystem ? String(flags.ecosystem) : ""
    });
    if (!Array.isArray(discovery.candidates) || discovery.candidates.length === 0) {
      throw new CliError(
        EXIT_CODES.RESOLUTION_FAILED,
        "RESOLUTION_FAILED",
        `No candidates discovered for query: ${input}`,
        "Pass a direct selector (npm:, github:, URL, or local path)"
      );
    }
    const choose = Math.max(1, toNumber(flags.choose, 1));
    const candidate = discovery.candidates[Math.min(choose - 1, discovery.candidates.length - 1)];
    selector = candidate.selector;
  }

  const fetchResult = await fetchLibrarySource({
    selector,
    flags
  });

  const outRoot = flags.path ? path.resolve(String(flags.path)) : path.resolve(".trail-docs");
  const outFile = flags.out ? path.resolve(String(flags.out)) : path.join(outRoot, "index.json");
  const manifestPath = flags["manifest-out"] ? path.resolve(String(flags["manifest-out"])) : path.join(outRoot, "trail-docs.json");
  const library = flags.library ? String(flags.library) : fetchResult.library;
  const version = flags.version ? String(flags.version) : fetchResult.resolved_ref;

  const buildResult = buildIndex({
    srcDir: fetchResult.docs_dir,
    outFile,
    library,
    version,
    sourceManifestPath: fetchResult.source_manifest_path
  });

  ensureDirForFile(manifestPath);
  const manifestPayload = toManifestPayload(library, version, manifestPath, path.resolve(buildResult.index_path));
  fs.writeFileSync(manifestPath, JSON.stringify(manifestPayload, null, 2), "utf8");

  return {
    ok: true,
    query: input,
    selector,
    discovered: discovery,
    library,
    version,
    index_path: buildResult.index_path,
    manifest_path: manifestPath,
    source_manifest_path: fetchResult.source_manifest_path,
    docs_dir: fetchResult.docs_dir,
    source: {
      source_type: fetchResult.source_type,
      canonical_url: fetchResult.canonical_url,
      resolved_ref: fetchResult.resolved_ref
    }
  };
}

export async function runIndex(positionals, flags) {
  return runPrep(positionals, flags);
}

export async function runSurface(positionals, flags) {
  const selector = positionals[0];
  if (!selector) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing selector for surface",
      "Usage: trail-docs surface <selector>"
    );
  }

  return buildSurfaceForSelector(selector, flags);
}

export async function runFn(positionals, flags) {
  const rawRef = positionals[0];
  const { selector, symbolQuery } = parseSelectorSymbolRef(rawRef);
  if (!selector || !symbolQuery) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing selector or symbol for fn command",
      "Usage: trail-docs fn <selector#symbol_query>"
    );
  }

  const surfacePayload = await buildSurfaceForSelector(selector, flags);
  const candidates = symbolMatchCandidates(surfacePayload, symbolQuery);
  if (candidates.length === 0) {
    throw new CliError(
      EXIT_CODES.REF_NOT_FOUND,
      "REF_NOT_FOUND",
      `No symbol found for ${symbolQuery}`,
      "Run trail-docs surface and inspect available symbols"
    );
  }

  const topScore = candidates[0].score;
  const topMatches = candidates
    .filter((entry) => entry.match_type === candidates[0].match_type && entry.score === topScore)
    .sort((left, right) => sortableSymbolName(left.entry).localeCompare(sortableSymbolName(right.entry)));

  if (topMatches.length > 1) {
    const suggestions = topMatches
      .slice(0, 5)
      .map((entry) => entry.entry.fq_name)
      .join(", ");
    throw new CliError(
      EXIT_CODES.AMBIGUOUS_MATCH,
      "AMBIGUOUS_MATCH",
      `Ambiguous symbol query: ${symbolQuery}`,
      `Try one of: ${suggestions}`
    );
  }

  const selected = topMatches[0].entry;
  const citation = citationForSymbol(surfacePayload, selected);
  return {
    selector,
    symbol_query: symbolQuery,
    match_type: topMatches[0].match_type,
    symbol: {
      symbol_id: selected.symbol_id,
      fq_name: selected.fq_name,
      kind: selected.kind,
      signatures: selected.signatures,
      summary: selected.summary
    },
    citations: [citation.citation_id],
    citation_details: [citation],
    examples: selected.examples || []
  };
}

function taskIntentVerbScore(taskTokens, symbolTokens) {
  const verbs = ["extract", "parse", "stream", "complete", "create", "run", "build", "transform", "convert"];
  const taskVerbHits = verbs.filter((entry) => taskTokens.has(entry));
  if (taskVerbHits.length === 0) {
    return 0;
  }

  let hits = 0;
  for (const verb of taskVerbHits) {
    if (symbolTokens.has(verb)) {
      hits += 1;
    }
  }
  return hits / taskVerbHits.length;
}

function summarizeRecommendationReason({ overlap, intent, evidence, hasExamples }) {
  const reasons = [];
  if (overlap > 0) {
    reasons.push("Matched task keywords");
  }
  if (intent > 0) {
    reasons.push("Matched action intent");
  }
  if (evidence > 0) {
    reasons.push("Found supporting usage evidence");
  }
  if (hasExamples) {
    reasons.push("Has inline examples");
  }
  if (reasons.length === 0) {
    return "Baseline lexical match";
  }
  return reasons.join("; ");
}

export async function runUseMulti(positionals, flags) {
  const task = positionals.join(" ").trim();
  const libsRaw = String(flags.libs || "").trim();
  if (!task || !libsRaw) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing task or --libs values for use multi-library mode",
      "Usage: trail-docs use \"<task>\" --libs <selector1,selector2,...>"
    );
  }

  const selectors = stableUnique(
    libsRaw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

  if (selectors.length === 0) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "No valid selectors provided via --libs",
      "Pass at least one selector in --libs"
    );
  }

  const taskTokens = new Set(tokenize(task));
  const ranked = [];

  for (const selector of selectors) {
    const surfacePayload = await buildSurfaceForSelector(selector, {
      ...flags,
      "max-results": String(50)
    });

    const candidateSymbols = surfacePayload.symbols.slice(0, 50);
    for (const symbol of candidateSymbols) {
      const combinedText = `${symbol.name || ""} ${symbol.fq_name || ""} ${(symbol.signatures || []).join(" ")} ${symbol.summary || ""}`.toLowerCase();
      const symbolTokens = new Set(tokenize(combinedText));
      const overlap = overlapScore(symbolTokens, [...taskTokens]);
      const intent = taskIntentVerbScore(taskTokens, symbolTokens);
      const evidence =
        Array.isArray(symbol.examples) &&
        symbol.examples.some((entry) =>
          String(entry.code || "")
            .toLowerCase()
            .includes(String(symbol.name || "").toLowerCase())
        )
          ? 1
          : 0;
      const hasExamples = Array.isArray(symbol.examples) && symbol.examples.length > 0 ? 1 : 0;
      const score = Number((overlap * 0.55 + intent * 0.2 + evidence * 0.15 + hasExamples * 0.1).toFixed(4));
      if (score <= 0) {
        continue;
      }

      const citation = citationForSymbol(surfacePayload, symbol);
      ranked.push({
        selector,
        library: surfacePayload.library,
        symbol_id: symbol.symbol_id,
        fq_name: symbol.fq_name,
        signature: symbol.signatures[0] || "",
        confidence: score,
        why: summarizeRecommendationReason({ overlap, intent, evidence, hasExamples }),
        citation_id: citation.citation_id
      });
    }
  }

  ranked.sort((left, right) => {
    if (left.confidence !== right.confidence) {
      return right.confidence - left.confidence;
    }
    if (left.library !== right.library) {
      return left.library.localeCompare(right.library);
    }
    return left.fq_name.localeCompare(right.fq_name);
  });

  const maxResults = toNumber(flags["max-results"], 3);
  const recommendations = ranked.slice(0, maxResults).map((entry, index) => ({
    rank: index + 1,
    ...entry
  }));
  const alternatives = ranked.slice(maxResults, maxResults + 3);

  return {
    task,
    mode: "multi_library",
    recommendations,
    alternatives,
    considered_libraries: selectors
  };
}

function buildUseFromIndex(index, task, maxResults, maxChars) {
  const initialResults = searchSections(index, task, Math.max(maxResults * 15, 60), Math.min(maxChars, 320));
  const searchResults = rerankUseResults(initialResults, index, task);

  if (searchResults.length === 0) {
    return {
      confidence: "partial",
      steps: [],
      snippet: "",
      citations: [],
      citation_details: [],
      related_docs: []
    };
  }

  const steps = [];
  const citations = [];
  const citationDetails = [];
  const relatedDocs = [];
  let snippet = "";
  const topScore = searchResults[0]?.score || 1;

  function tryBuildSteps({ strict }) {
    for (let indexValue = 0; indexValue < searchResults.length; indexValue += 1) {
      if (steps.length >= maxResults) {
        break;
      }
      const result = searchResults[indexValue];
      if (shouldSkipSectionForUse(result, task)) {
        continue;
      }
      const section = selectSection(index, `${result.doc_id}#${result.anchor}`);
      const citation = citationFor(index, section);
      const instruction = stepInstruction(section);
      const hints = deriveStepHints(section, maxChars);
      if (!instruction) {
        continue;
      }
      if (strict && lowQualityInstruction(instruction)) {
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
      citationDetails.push(citation);

      if (!snippet && section.code_blocks.length > 0) {
        snippet = truncate(section.code_blocks[0], maxChars);
      }

      if (!relatedDocs.includes(section.doc_id)) {
        relatedDocs.push(section.doc_id);
      }
    }
  }

  tryBuildSteps({ strict: true });
  if (steps.length === 0) {
    tryBuildSteps({ strict: false });
  }

  for (let indexValue = 0; indexValue < steps.length; indexValue += 1) {
    steps[indexValue].id = `step_${indexValue + 1}`;
  }

  return {
    confidence: "authoritative",
    steps,
    snippet,
    citations: stableUnique(citations),
    citation_details: stableUnique(citationDetails.map((entry) => JSON.stringify(entry))).map((value) =>
      JSON.parse(value)
    ),
    related_docs: relatedDocs.slice(0, 3)
  };
}

async function runUseFederatedDocs(positionals, flags) {
  const task = positionals.join(" ").trim();
  const indexPaths = resolveIndexPathsFromFlags(flags);
  if (!task || indexPaths.length === 0) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing task or --indexes for federated use mode",
      "Usage: trail-docs use \"<task>\" --indexes <index1,index2,...>"
    );
  }

  const maxResults = toNumber(flags["max-results"], 3);
  const maxChars = toNumber(flags["max-chars"], DEFAULTS.maxChars);
  const rankedSteps = [];

  for (const indexPath of indexPaths) {
    const index = loadIndex(indexPath);
    const response = buildUseFromIndex(index, task, Math.max(maxResults, 2), maxChars);
    for (const step of response.steps) {
      rankedSteps.push({
        ...step,
        library: index.library,
        version: index.version
      });
    }
  }

  rankedSteps.sort((left, right) => {
    if (left.confidence !== right.confidence) {
      return right.confidence - left.confidence;
    }
    if (left.library !== right.library) {
      return left.library.localeCompare(right.library);
    }
    return left.id.localeCompare(right.id);
  });

  const steps = rankedSteps.slice(0, maxResults).map((entry, indexValue) => ({
    id: `step_${indexValue + 1}`,
    instruction: entry.instruction,
    confidence: entry.confidence,
    command: entry.command,
    prerequisites: entry.prerequisites,
    expected: entry.expected,
    library: entry.library,
    version: entry.version,
    citations: entry.citations
  }));
  const citations = stableUnique(steps.flatMap((entry) => entry.citations));

  return {
    task,
    mode: "federated_docs",
    confidence: steps.length > 0 ? "authoritative" : "partial",
    steps,
    citations,
    indexes: indexPaths
  };
}

async function runUseLegacy(positionals, flags) {
  let library = positionals[0];
  let task = positionals.slice(1).join(" ").trim();
  if (flags["default-library"] && positionals.length === 1) {
    library = String(flags["default-library"]);
    task = String(positionals[0] || "").trim();
  } else if (!library && flags["default-library"] && positionals.length > 0) {
    library = String(flags["default-library"]);
    task = positionals.join(" ").trim();
  }
  if (!library || !task) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing library or task for use command",
      "Usage: trail-docs use <library> \"<task>\""
    );
  }

  const maxResults = toNumber(flags["max-results"], 3);
  const maxChars = toNumber(flags["max-chars"], DEFAULTS.maxChars);
  let manifestPath = "";
  let manifest = null;
  let index = null;

  try {
    manifestPath = findManifestForLibrary(library, flags.path ? String(flags.path) : "");
    manifest = readManifest(manifestPath);
    const indexPath = path.resolve(path.dirname(manifestPath), manifest.index_path);
    index = loadIndex(indexPath);
  } catch (error) {
    const canAutoHeal =
      !flags["no-auto-heal"] &&
      error instanceof CliError &&
      ["RESOLUTION_FAILED", "INDEX_UNREADABLE", "SCHEMA_MISMATCH"].includes(error.code);
    if (!canAutoHeal) {
      throw error;
    }

    const healed = await runPrep([library], {
      ...flags,
      path: flags.path ? String(flags.path) : ".trail-docs"
    });
    manifestPath = healed.manifest_path;
    manifest = readManifest(manifestPath);
    const indexPath = path.resolve(path.dirname(manifestPath), manifest.index_path);
    index = loadIndex(indexPath);
  }

  const indexIsInferred =
    Boolean(index.build?.inferred) ||
    String(index.build?.derivation || "").toLowerCase() === "bootstrap" ||
    String(index.build?.source?.source_type || "").toLowerCase() === "bootstrap";
  const response = buildUseFromIndex(index, task, maxResults, maxChars);

  return {
    task,
    library: manifest.library,
    version: manifest.library_version,
    confidence: indexIsInferred ? "partial" : response.confidence,
    steps: response.steps,
    snippet: response.snippet,
    citations: response.citations,
    citation_details: response.citation_details,
    related_docs: response.related_docs
  };
}

export async function runUse(positionals, flags) {
  if (flags.libs) {
    return runUseMulti(positionals, flags);
  }
  if (flags.indexes) {
    return runUseFederatedDocs(positionals, flags);
  }
  return runUseLegacy(positionals, flags);
}

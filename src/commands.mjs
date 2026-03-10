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
  ensureDirForFile,
  parseDocRef,
  stableUnique,
  tokenize,
  truncate
} from "./utils.mjs";
import {
  expandNavigation,
  extractNavigation,
  findNavigation,
  neighborsNavigation,
  parseRefs
} from "./navigation.mjs";
import {
  addTrailRef,
  addTrailTag,
  createTrailState,
  pinTrailCitation,
  showTrailState,
  trailExists
} from "./trail-state.mjs";

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
    schema_version: "2",
    library,
    library_version: version,
    index_path: relativeIndexPath || "index.json",
    built_at: new Date().toISOString()
  };
}

function resolveIndexForCommand(flags) {
  return flags.index ? path.resolve(String(flags.index)) : path.resolve(".trail-docs/index.json");
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
      "Run trail-docs find with a related query"
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

function ensureRefList(index, refs) {
  const validated = [];
  for (const ref of refs) {
    const section = selectSection(index, ref);
    validated.push(`${section.doc_id}#${section.anchor}`);
  }
  return stableUnique(validated);
}

function validateCitationId(value) {
  return /^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:[A-Za-z0-9_./-]+#[A-Za-z0-9_./-]+:\d+-\d+$/.test(String(value || ""));
}

function resolveMaxItems(flags) {
  return toNumber(flags["max-items"] || flags["max-results"], DEFAULTS.maxResults);
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
    schema_version: index.schema_version,
    library: index.library,
    version: index.version,
    docs_count: index.docs.length,
    sections_count: index.sections.length,
    evidence_units_count: (index.evidence_units || []).length,
    anchors_count: (index.anchor_graph || []).length,
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
      schema_version: "2",
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

export function runFind(positionals, flags) {
  const query = positionals.join(" ").trim();
  if (!query) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing query text for find",
      "Usage: trail-docs find <query>"
    );
  }

  const index = loadIndex(resolveIndexForCommand(flags));
  return {
    library: index.library,
    version: index.version,
    ...findNavigation({
      index,
      query,
      budget: flags.budget,
      maxItems: resolveMaxItems(flags)
    })
  };
}

export function runSearch(positionals, flags) {
  return runFind(positionals, flags);
}

export function runExpand(positionals, flags) {
  const rawRef = positionals[0];
  if (!rawRef) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing reference for expand",
      "Usage: trail-docs expand <doc_id#anchor>"
    );
  }

  const index = loadIndex(resolveIndexForCommand(flags));
  const section = selectSection(index, rawRef);
  return {
    library: index.library,
    version: index.version,
    ...expandNavigation({
      index,
      ref: `${section.doc_id}#${section.anchor}`,
      budget: flags.budget,
      maxItems: resolveMaxItems(flags)
    })
  };
}

export function runNeighbors(positionals, flags) {
  const rawRef = positionals[0];
  if (!rawRef) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing reference for neighbors",
      "Usage: trail-docs neighbors <doc_id#anchor>"
    );
  }

  const index = loadIndex(resolveIndexForCommand(flags));
  const section = selectSection(index, rawRef);
  return {
    library: index.library,
    version: index.version,
    ...neighborsNavigation({
      index,
      ref: `${section.doc_id}#${section.anchor}`
    })
  };
}

export function runExtract(positionals, flags) {
  const query = positionals.join(" ").trim();
  if (!query) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing query text for extract",
      "Usage: trail-docs extract <query> --from <ref1,ref2,...>"
    );
  }

  const rawRefs = parseRefs(flags.from);
  if (rawRefs.length === 0) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing --from refs for extract",
      "Pass --from <doc#anchor,doc#anchor>"
    );
  }

  const index = loadIndex(resolveIndexForCommand(flags));
  const refs = ensureRefList(index, rawRefs);

  return {
    library: index.library,
    version: index.version,
    ...extractNavigation({
      index,
      query,
      refs,
      budget: flags.budget,
      maxItems: resolveMaxItems(flags)
    })
  };
}

export function runOpen(positionals, flags) {
  const rawRef = positionals[0];
  if (!rawRef) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing reference for open",
      "Usage: trail-docs open <doc_id#anchor> [--mode section|units]"
    );
  }

  const index = loadIndex(resolveIndexForCommand(flags));
  const section = selectSection(index, rawRef);
  const mode = String(flags.mode || "units").toLowerCase();

  if (mode === "section") {
    const maxChars = toNumber(flags["max-chars"], DEFAULTS.maxChars);
    return {
      library: index.library,
      version: index.version,
      ref: `${section.doc_id}#${section.anchor}`,
      mode: "section",
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

  return {
    library: index.library,
    version: index.version,
    mode: "units",
    ...expandNavigation({
      index,
      ref: `${section.doc_id}#${section.anchor}`,
      budget: flags.budget,
      maxItems: resolveMaxItems(flags)
    })
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
  const manifestPath = flags["manifest-out"]
    ? path.resolve(String(flags["manifest-out"]))
    : path.join(outRoot, "trail-docs.json");
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

export function runTrail(positionals, flags) {
  const action = String(positionals[0] || "").trim().toLowerCase();
  if (!action) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing trail action",
      "Usage: trail-docs trail <create|add|pin|tag|show> ..."
    );
  }

  if (action === "create") {
    const objective = requireFlag(flags, "objective");
    return createTrailState({
      objective,
      trailId: flags.trail ? String(flags.trail) : ""
    });
  }

  const trailId = requireFlag(flags, "trail");
  if (!trailExists({ trailId })) {
    throw new CliError(
      EXIT_CODES.REF_NOT_FOUND,
      "REF_NOT_FOUND",
      `Trail not found: ${trailId}`,
      "Create one with trail-docs trail create --objective \"...\""
    );
  }

  if (action === "show") {
    return showTrailState({ trailId });
  }

  if (action === "add") {
    const ref = requireFlag(flags, "ref");
    const index = loadIndex(resolveIndexForCommand(flags));
    const section = selectSection(index, ref);
    return addTrailRef({
      trailId,
      ref: `${section.doc_id}#${section.anchor}`
    });
  }

  if (action === "pin") {
    const citation = requireFlag(flags, "citation");
    if (!validateCitationId(citation)) {
      throw new CliError(
        EXIT_CODES.INVALID_ARGS,
        "INVALID_ARGS",
        `Invalid citation: ${citation}`,
        "Use citation format library@version:doc#anchor:start-end"
      );
    }
    return pinTrailCitation({ trailId, citationId: citation });
  }

  if (action === "tag") {
    const tag = requireFlag(flags, "tag");
    return addTrailTag({ trailId, tag });
  }

  throw new CliError(
    EXIT_CODES.INVALID_ARGS,
    "INVALID_ARGS",
    `Unknown trail action: ${action}`,
    "Use create, add, pin, tag, or show"
  );
}

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
      snippet: truncate(section.snippet, Math.min(maxChars, 400)),
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

function stepInstruction(section) {
  const cleaned = section.text
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 12) {
    return "";
  }

  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter((value) => value.length > 0);
  if (sentences.length === 0) {
    return cleaned;
  }
  return sentences[0];
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

  if (explicitPath) {
    candidates.push(path.resolve(explicitPath, "doccli.json"));
  }

  const envPaths = process.env.DOCCLI_PATHS || "";
  if (envPaths) {
    for (const entry of envPaths.split(path.delimiter)) {
      if (entry.trim()) {
        candidates.push(path.resolve(entry.trim(), library, "doccli.json"));
        candidates.push(path.resolve(entry.trim(), "doccli.json"));
      }
    }
  }

  let current = process.cwd();
  while (true) {
    candidates.push(path.join(current, "node_modules", library, "doccli.json"));
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new CliError(
    EXIT_CODES.RESOLUTION_FAILED,
    "RESOLUTION_FAILED",
    `Could not locate docs manifest for library ${library}`,
    "Install docs artifact, set DOCCLI_PATHS, or pass --path"
  );
}

function resolveIndexForCommand(flags) {
  return flags.index ? path.resolve(String(flags.index)) : path.resolve(".doccli/index.json");
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
      citations: []
    };
  }

  const steps = [];
  const citations = [];
  let snippet = "";

  for (let indexValue = 0; indexValue < searchResults.length; indexValue += 1) {
    const result = searchResults[indexValue];
    const section = selectSection(index, `${result.doc_id}#${result.anchor}`);
    const citation = citationFor(index, section);
    const instruction = stepInstruction(section);
    if (!instruction) {
      continue;
    }
    steps.push({
      id: `step_${steps.length + 1}`,
      instruction,
      citations: [citation.citation_id]
    });
    citations.push(citation.citation_id);

    if (!snippet && section.code_blocks.length > 0) {
      snippet = truncate(section.code_blocks[0], maxChars);
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
      citations: []
    };
  }

  return {
    task,
    library: manifest.library,
    version: manifest.library_version,
    confidence: "authoritative",
    steps,
    snippet,
    citations: stableUnique(citations)
  };
}

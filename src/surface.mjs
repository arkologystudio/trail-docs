import fs from "node:fs";
import path from "node:path";
import { fetchLibrarySource } from "./fetcher.mjs";
import { DEFAULTS, EXIT_CODES } from "./constants.mjs";
import { CliError } from "./errors.mjs";
import { mineExamples } from "./example-miner.mjs";
import { extractTypeScriptSurface } from "./symbol-extractor-ts.mjs";
import {
  parseSelector,
  resolveLocalNpmSource,
  resolveSurfaceRootFromFetchResult
} from "./source-resolver.mjs";
import { ensureDirForFile, hashText } from "./utils.mjs";

const EXTRACTOR_VERSION = "ts-surface-v1";

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

function readPackageMeta(rootDir) {
  const packageJsonPath = path.join(rootDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return {
      library: path.basename(rootDir),
      version: "local"
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return {
      library: parsed.name || path.basename(rootDir),
      version: parsed.version || "local"
    };
  } catch {
    return {
      library: path.basename(rootDir),
      version: "local"
    };
  }
}

async function resolveSurfaceSource(selector, flags = {}) {
  const parsed = parseSelector(selector);
  if (!parsed) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing selector for surface",
      "Usage: trail-docs surface <selector>"
    );
  }

  if (parsed.type === "npm") {
    const localNpm = resolveLocalNpmSource(selector, process.cwd());
    if (localNpm) {
      return {
        selector,
        library: localNpm.library,
        version: localNpm.version,
        source_root: localNpm.source_root,
        source: {
          source_type: localNpm.source_type,
          provider: localNpm.provider,
          canonical_url: localNpm.canonical_url,
          resolved_ref: localNpm.resolved_ref,
          snapshot_dir: localNpm.snapshot_dir
        }
      };
    }
  }

  if (parsed.type === "local_dir") {
    const packageMeta = readPackageMeta(parsed.path);
    const stat = fs.statSync(parsed.path);
    const resolvedRef = hashText(`${parsed.path}:${stat.mtimeMs}:${packageMeta.version}`).slice(0, 12);
    return {
      selector,
      library: packageMeta.library,
      version: packageMeta.version,
      source_root: parsed.path,
      source: {
        source_type: "local",
        provider: "local",
        canonical_url: `file://${parsed.path}`,
        resolved_ref: resolvedRef,
        snapshot_dir: ""
      }
    };
  }

  if (parsed.type === "local_file") {
    const parent = path.dirname(parsed.path);
    const packageMeta = readPackageMeta(parent);
    const stat = fs.statSync(parsed.path);
    const resolvedRef = hashText(`${parsed.path}:${stat.mtimeMs}:${packageMeta.version}`).slice(0, 12);
    return {
      selector,
      library: packageMeta.library,
      version: packageMeta.version,
      source_root: parent,
      source: {
        source_type: "local",
        provider: "local",
        canonical_url: `file://${parsed.path}`,
        resolved_ref: resolvedRef,
        snapshot_dir: ""
      }
    };
  }

  const fetched = await fetchLibrarySource({ selector, flags });
  const sourceRoot = resolveSurfaceRootFromFetchResult(fetched);
  return {
    selector,
    library: fetched.library,
    version: fetched.resolved_ref || fetched.version,
    source_root: sourceRoot,
    source: {
      source_type: fetched.source_type,
      provider: fetched.source_type === "registry" ? "npm" : fetched.source_type,
      canonical_url: fetched.canonical_url,
      resolved_ref: fetched.resolved_ref,
      snapshot_dir: fetched.snapshot_dir
    }
  };
}

function surfaceCachePath(selector, resolvedRef, canonicalUrl, cacheRoot) {
  const keySeed = JSON.stringify({
    selector,
    resolved_ref: resolvedRef,
    canonical_url: canonicalUrl,
    extractor_version: EXTRACTOR_VERSION
  });
  const key = hashText(keySeed).slice(0, 24);
  return path.join(cacheRoot, key, "surface.json");
}

function loadSurfaceCache(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeSurfaceCache(filePath, payload) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function applySymbolFilters(surfacePayload, { symbolKind, maxResults }) {
  const normalizedKind = symbolKind ? String(symbolKind).toLowerCase() : "all";
  const allowedKinds = new Set(["all", "function", "class", "method", "type"]);
  const finalKind = allowedKinds.has(normalizedKind) ? normalizedKind : "all";

  const filteredSymbols =
    finalKind === "all"
      ? surfacePayload.symbols
      : surfacePayload.symbols.filter((entry) => entry.kind === finalKind);

  const limitedSymbols = filteredSymbols.slice(0, maxResults);
  const allowedSymbolIds = new Set(limitedSymbols.map((entry) => entry.symbol_id));
  const filteredExports = surfacePayload.exports.filter((entry) => allowedSymbolIds.has(entry.symbol_id));

  return {
    ...surfacePayload,
    exports: filteredExports,
    symbols: limitedSymbols
  };
}

export function citationForSymbol(surfacePayload, symbol) {
  return {
    citation_id: `${surfacePayload.library}@${surfacePayload.version}:symbol:${symbol.symbol_id}:${symbol.module_path}:${symbol.line_start}-${symbol.line_end}`,
    source_path: symbol.module_path,
    line_start: symbol.line_start,
    line_end: symbol.line_end,
    provenance: {
      source_type: surfacePayload.source?.source_type || "",
      provider: surfacePayload.source?.provider || "",
      canonical_url: surfacePayload.source?.canonical_url || "",
      resolved_ref: surfacePayload.source?.resolved_ref || ""
    }
  };
}

export async function buildSurfaceForSelector(selector, flags = {}) {
  const resolved = await resolveSurfaceSource(selector, flags);
  const cacheRoot = flags["cache-dir"]
    ? path.resolve(String(flags["cache-dir"]))
    : path.resolve(".trail-docs", "cache", "surfaces");
  const cacheFile = surfaceCachePath(selector, resolved.source.resolved_ref, resolved.source.canonical_url, cacheRoot);
  const maxExamples = toNumber(flags.examples, DEFAULTS.surfaceMaxExamples);
  const maxResults = toNumber(flags["max-results"], DEFAULTS.surfaceMaxSymbols);
  const symbolKind = flags["symbol-kind"] ? String(flags["symbol-kind"]) : "all";

  if (!flags["no-cache"]) {
    const cached = loadSurfaceCache(cacheFile);
    if (cached) {
      return {
        ...applySymbolFilters(cached, { symbolKind, maxResults }),
        cache_hit: true
      };
    }
  }

  const extracted = extractTypeScriptSurface({
    library: resolved.library,
    rootDir: resolved.source_root,
    maxFiles: DEFAULTS.surfaceMaxFiles,
    maxBytes: DEFAULTS.surfaceMaxBytes
  });

  const examplesBySymbol = mineExamples({
    rootDir: resolved.source_root,
    symbols: extracted.symbols,
    maxExamples
  });

  const symbols = extracted.symbols.map((symbol) => ({
    ...symbol,
    examples: examplesBySymbol.get(symbol.symbol_id) || []
  }));

  const payload = {
    ok: true,
    selector,
    library: resolved.library,
    version: resolved.version,
    confidence: extracted.confidence,
    source: resolved.source,
    exports: extracted.exports,
    symbols,
    stats: extracted.stats
  };

  writeSurfaceCache(cacheFile, payload);

  return {
    ...applySymbolFilters(payload, { symbolKind, maxResults }),
    cache_hit: false
  };
}

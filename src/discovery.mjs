import fs from "node:fs";
import path from "node:path";
import { CliError } from "./errors.mjs";
import { DEFAULTS, EXIT_CODES } from "./constants.mjs";
import { stableUnique, tokenize } from "./utils.mjs";

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

function scoreMatch(text, queryTokens) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized || queryTokens.length === 0) {
    return 0;
  }

  let score = 0;
  for (const token of queryTokens) {
    if (normalized.includes(token)) {
      score += 1;
    }
  }
  return score / queryTokens.length;
}

function sortCandidates(candidates) {
  candidates.sort((left, right) => {
    if (left.confidence !== right.confidence) {
      return right.confidence - left.confidence;
    }
    if (left.trust_score !== right.trust_score) {
      return right.trust_score - left.trust_score;
    }
    return left.name.localeCompare(right.name);
  });
}

function normalizeConfidence(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

function normalizePackageName(value) {
  return String(value || "").trim().toLowerCase();
}

function packageNameSignals(pkgName, query) {
  const normalizedPackage = normalizePackageName(pkgName);
  const normalizedQuery = normalizePackageName(query);
  const queryNoPrefix = normalizedQuery.replace(/^(@types\/|types\/)/, "");

  return {
    exact: normalizedPackage === normalizedQuery || normalizedPackage === queryNoPrefix,
    scopedTypeDef: normalizedPackage.startsWith("@types/"),
    startsWith: normalizedPackage.startsWith(normalizedQuery),
    contains: normalizedPackage.includes(normalizedQuery)
  };
}

function toCandidate(input) {
  return {
    name: String(input.name || "").trim(),
    selector: String(input.selector || "").trim(),
    source_type: String(input.source_type || "catalog").trim() || "catalog",
    ecosystem: String(input.ecosystem || "").trim(),
    canonical_url: String(input.canonical_url || "").trim(),
    description: String(input.description || "").trim(),
    versions: Array.isArray(input.versions) ? input.versions.map((entry) => String(entry)) : [],
    trust_score: Number.isFinite(input.trust_score) ? Number(input.trust_score) : 0,
    benchmark_score: Number.isFinite(input.benchmark_score) ? Number(input.benchmark_score) : 0,
    confidence: Number.isFinite(input.confidence) ? Number(input.confidence) : 0
  };
}

function filterByEcosystem(candidates, ecosystem) {
  if (!ecosystem) {
    return candidates;
  }

  return candidates.filter((candidate) => {
    if (!candidate.ecosystem) {
      return false;
    }
    return candidate.ecosystem.toLowerCase() === ecosystem.toLowerCase();
  });
}

function discoverFromCatalog(query, maxResults, catalogPath, ecosystem = "") {
  if (!catalogPath) {
    return [];
  }

  const resolved = path.resolve(catalogPath);
  if (!fs.existsSync(resolved)) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `Catalog file does not exist: ${catalogPath}`,
      "Pass --catalog <file> pointing at a valid JSON file"
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `Catalog file is not valid JSON: ${catalogPath}`,
      "Fix the catalog JSON syntax"
    );
  }

  if (!Array.isArray(parsed)) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `Catalog must be a JSON array: ${catalogPath}`,
      "Provide an array of discovery candidates"
    );
  }

  const queryTokens = tokenize(query);
  const candidates = [];

  for (const item of parsed) {
    const candidate = toCandidate(item);
    if (!candidate.name || !candidate.selector) {
      continue;
    }

    const base = candidate.confidence || scoreMatch(`${candidate.name} ${candidate.description}`, queryTokens);
    candidate.confidence = normalizeConfidence(base);
    candidates.push(candidate);
  }

  const filtered = filterByEcosystem(candidates, ecosystem);
  sortCandidates(filtered);
  return filtered.slice(0, maxResults);
}

async function readJsonWithRateLimit(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "trail-docs/0.1.0"
    }
  });

  if (response.status === 429) {
    throw new CliError(
      EXIT_CODES.FETCH_RATE_LIMITED,
      "FETCH_RATE_LIMITED",
      `Rate limited by upstream provider: ${url}`,
      "Retry later or use --provider catalog"
    );
  }

  if (!response.ok) {
    throw new CliError(
      EXIT_CODES.DISCOVERY_FAILED,
      "DISCOVERY_FAILED",
      `Discovery request failed (${response.status}) for ${url}`,
      "Try a narrower query or switch providers"
    );
  }

  return response.json();
}

async function discoverFromNpm(query, maxResults, ecosystem = "") {
  if (ecosystem && ecosystem.toLowerCase() !== "npm") {
    return [];
  }

  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${Math.max(
    maxResults,
    DEFAULTS.maxResults
  )}`;
  const data = await readJsonWithRateLimit(url);
  const queryTokens = tokenize(query);
  const candidates = [];

  for (const entry of data.objects || []) {
    const pkg = entry.package || {};
    const trust = entry.score?.final || 0;
    const signals = packageNameSignals(pkg.name || "", query);
    let confidence =
      scoreMatch(`${pkg.name || ""} ${pkg.description || ""}`, queryTokens) * 0.55 +
      Math.min(0.1, trust / 20);

    if (signals.exact) {
      confidence += 0.5;
    } else if (signals.startsWith) {
      confidence += 0.15;
    } else if (signals.contains) {
      confidence += 0.08;
    }
    if (signals.scopedTypeDef && !signals.exact) {
      confidence -= 0.2;
    }

    candidates.push({
      name: pkg.name || "",
      selector: `npm:${pkg.name || ""}`,
      source_type: "registry",
      ecosystem: "npm",
      canonical_url: pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`,
      description: pkg.description || "",
      versions: pkg.version ? [pkg.version] : [],
      trust_score: Number((Math.max(0, Math.min(1, trust / 2))).toFixed(3)),
      benchmark_score: 0,
      confidence: normalizeConfidence(confidence)
    });
  }

  sortCandidates(candidates);
  return candidates.slice(0, maxResults);
}

function parseGithubSelector(input) {
  const value = String(input || "").trim();
  if (!value) {
    return null;
  }

  const short = value.match(/^github:([^/]+)\/([^#\s]+)$/i);
  if (short) {
    return {
      owner: short[1],
      repo: short[2],
      selector: `github:${short[1]}/${short[2]}`,
      canonical: `https://github.com/${short[1]}/${short[2]}`
    };
  }

  try {
    const parsed = new URL(value);
    if (parsed.hostname !== "github.com") {
      return null;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return null;
    }

    return {
      owner: parts[0],
      repo: parts[1].replace(/\.git$/i, ""),
      selector: `github:${parts[0]}/${parts[1].replace(/\.git$/i, "")}`,
      canonical: `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/i, "")}`
    };
  } catch {
    return null;
  }
}

async function discoverFromGithub(query, maxResults, ecosystem = "") {
  if (ecosystem && ecosystem.toLowerCase() !== "github") {
    return [];
  }

  const direct = parseGithubSelector(query);
  if (direct) {
    return [
      {
        name: `${direct.owner}/${direct.repo}`,
        selector: direct.selector,
        source_type: "github",
        ecosystem: "github",
        canonical_url: direct.canonical,
        description: "GitHub repository",
        versions: [],
        trust_score: 0.5,
        benchmark_score: 0,
        confidence: 1
      }
    ];
  }

  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${Math.max(
    maxResults,
    DEFAULTS.maxResults
  )}`;
  const data = await readJsonWithRateLimit(url);
  const queryTokens = tokenize(query);
  const candidates = [];

  for (const entry of data.items || []) {
    const popularity = Math.log10(1 + Number(entry.stargazers_count || 0));
    const confidence = scoreMatch(`${entry.full_name || ""} ${entry.description || ""}`, queryTokens) * 0.7 + Math.min(0.3, popularity / 10);

    candidates.push({
      name: entry.full_name || "",
      selector: `github:${entry.owner?.login || ""}/${entry.name || ""}`,
      source_type: "github",
      ecosystem: "github",
      canonical_url: entry.html_url || "",
      description: entry.description || "",
      versions: entry.default_branch ? [entry.default_branch] : [],
      trust_score: Number(Math.max(0, Math.min(1, popularity / 4)).toFixed(3)),
      benchmark_score: 0,
      confidence: normalizeConfidence(confidence)
    });
  }

  sortCandidates(candidates);
  return candidates.slice(0, maxResults);
}

function directUrlCandidate(query) {
  try {
    const parsed = new URL(query);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return null;
    }

    const github = parseGithubSelector(query);
    if (github) {
      return {
        name: `${github.owner}/${github.repo}`,
        selector: github.selector,
        source_type: "github",
        ecosystem: "github",
        canonical_url: github.canonical,
        description: "GitHub repository",
        versions: [],
        trust_score: 0.5,
        benchmark_score: 0,
        confidence: 1
      };
    }

    return {
      name: parsed.hostname,
      selector: parsed.toString(),
      source_type: "docs",
      ecosystem: "docs",
      canonical_url: parsed.toString(),
      description: "Documentation URL",
      versions: [],
      trust_score: 0.4,
      benchmark_score: 0,
      confidence: 0.95
    };
  } catch {
    return null;
  }
}

export async function discoverLibraries({
  query,
  maxResults = DEFAULTS.maxResults,
  provider = "all",
  catalogPath = "",
  ecosystem = ""
}) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing query text for discover",
      "Usage: trail-docs discover <query>"
    );
  }

  const limit = toNumber(maxResults, DEFAULTS.maxResults);
  const providers = provider === "all" ? ["catalog", "npm", "github"] : stableUnique([provider]);
  const candidates = [];

  const direct = directUrlCandidate(normalizedQuery);
  if (direct) {
    candidates.push(direct);
  }

  for (const entry of providers) {
    if (entry === "catalog") {
      candidates.push(...discoverFromCatalog(normalizedQuery, limit, catalogPath, ecosystem));
      continue;
    }

    if (entry === "npm") {
      candidates.push(...(await discoverFromNpm(normalizedQuery, limit, ecosystem)));
      continue;
    }

    if (entry === "github") {
      candidates.push(...(await discoverFromGithub(normalizedQuery, limit, ecosystem)));
      continue;
    }

    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `Unknown provider: ${entry}`,
      "Use --provider all|catalog|npm|github"
    );
  }

  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = `${candidate.selector}:${candidate.source_type}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }

  const filtered = filterByEcosystem(deduped, ecosystem);
  sortCandidates(filtered);

  return {
    query: normalizedQuery,
    provider,
    ecosystem,
    candidates: filtered.slice(0, limit)
  };
}

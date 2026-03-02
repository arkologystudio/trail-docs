import fs from "node:fs";
import path from "node:path";
import { hashText, toPosixPath } from "./utils.mjs";

export function parseSelector(selector) {
  const value = String(selector || "").trim();
  if (!value) {
    return null;
  }

  if (value.startsWith("npm:")) {
    return { type: "npm", package_name: value.slice(4) };
  }

  const shortGithub = value.match(/^github:([^/]+)\/([^#\s]+)$/i);
  if (shortGithub) {
    return { type: "github", owner: shortGithub[1], repo: shortGithub[2] };
  }

  if (fs.existsSync(path.resolve(value))) {
    const full = path.resolve(value);
    const stat = fs.statSync(full);
    return { type: stat.isDirectory() ? "local_dir" : "local_file", path: full };
  }

  try {
    const parsed = new URL(value);
    if (parsed.hostname === "github.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        return {
          type: "github",
          owner: parts[0],
          repo: parts[1].replace(/\.git$/i, "")
        };
      }
    }

    return { type: "docs_url", url: parsed.toString() };
  } catch {
    return { type: "npm", package_name: value };
  }
}

export function snapshotKey(source) {
  const seed = JSON.stringify({
    source_type: source.source_type,
    library: source.library,
    resolved_ref: source.resolved_ref,
    canonical_url: source.canonical_url
  });
  return hashText(seed).slice(0, 24);
}

export function docsPathFor(snapshotDir) {
  return path.join(snapshotDir, "docs");
}

export function readManifestIfPresent(snapshotDir) {
  const candidate = path.join(snapshotDir, ".doc-nav", "source.json");
  if (!fs.existsSync(candidate)) {
    return null;
  }

  try {
    return {
      manifest_path: candidate,
      manifest: JSON.parse(fs.readFileSync(candidate, "utf8"))
    };
  } catch {
    return null;
  }
}

function readPackageJson(packageDir) {
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    return null;
  }
}

function collectExportPaths(value, output) {
  if (!value) {
    return;
  }

  if (typeof value === "string") {
    output.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectExportPaths(entry, output);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const preferredKeys = ["types", "typings", "import", "require", "default"];
  for (const key of preferredKeys) {
    if (typeof value[key] === "string") {
      output.push(value[key]);
    }
  }

  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    if (preferredKeys.includes(key)) {
      continue;
    }
    collectExportPaths(value[key], output);
  }
}

function normalizeCandidatePath(rawPath) {
  if (!rawPath || typeof rawPath !== "string") {
    return "";
  }
  if (rawPath.startsWith("./")) {
    return rawPath.slice(2);
  }
  return rawPath;
}

function toExistingSourcePath(packageDir, rawPath) {
  const normalized = normalizeCandidatePath(rawPath);
  if (!normalized) {
    return "";
  }

  const full = path.resolve(packageDir, normalized);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    return full;
  }

  const extensions = ["", ".d.ts", ".ts", ".tsx", ".js", ".mjs", ".cjs"];
  for (const extension of extensions) {
    const candidate = full + extension;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  const indexCandidates = [
    path.join(full, "index.d.ts"),
    path.join(full, "index.ts"),
    path.join(full, "index.tsx"),
    path.join(full, "index.js"),
    path.join(full, "index.mjs"),
    path.join(full, "index.cjs")
  ];

  for (const candidate of indexCandidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return "";
}

export function resolvePackageEntryCandidates(packageDir) {
  const parsed = readPackageJson(packageDir) || {};
  const candidates = [];

  if (parsed.exports) {
    collectExportPaths(parsed.exports, candidates);
  }

  const preferred = [parsed.types, parsed.typings, parsed.module, parsed.main, "index.d.ts", "dist/index.d.ts", "src/index.ts", "index.js"];
  for (const item of preferred) {
    if (item) {
      candidates.push(String(item));
    }
  }

  const seen = new Set();
  const output = [];
  for (const candidate of candidates) {
    const resolved = toExistingSourcePath(packageDir, candidate);
    if (!resolved) {
      continue;
    }
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    output.push(resolved);
  }

  return output;
}

export function findLocalNpmPackageDir(packageName, startDir = process.cwd()) {
  const normalized = String(packageName || "").trim();
  if (!normalized) {
    return "";
  }

  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, "node_modules", normalized);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return "";
}

export function resolveLocalNpmSource(selector, startDir = process.cwd()) {
  const parsed = parseSelector(selector);
  if (!parsed || parsed.type !== "npm") {
    return null;
  }

  const packageDir = findLocalNpmPackageDir(parsed.package_name, startDir);
  if (!packageDir) {
    return null;
  }

  const packageJsonPath = path.join(packageDir, "package.json");
  let version = "local";
  if (fs.existsSync(packageJsonPath)) {
    try {
      version = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version || "local";
    } catch {
      version = "local";
    }
  }

  const stat = fs.statSync(packageDir);
  const resolvedRef = hashText(`${packageDir}:${stat.mtimeMs}:${version}`).slice(0, 12);

  return {
    selector,
    library: parsed.package_name,
    version,
    source_type: "local",
    provider: "local",
    canonical_url: `file://${toPosixPath(packageDir)}`,
    requested_ref: "local",
    resolved_ref: resolvedRef,
    integrity: resolvedRef,
    source_root: packageDir,
    snapshot_dir: ""
  };
}

export function resolveSurfaceRootFromFetchResult(fetchResult) {
  const snapshotDir = path.resolve(fetchResult.snapshot_dir || "");
  const rawDir = snapshotDir ? path.join(snapshotDir, "raw") : "";

  if (rawDir && fs.existsSync(rawDir) && fs.statSync(rawDir).isDirectory()) {
    return rawDir;
  }

  if (fetchResult.docs_dir && fs.existsSync(fetchResult.docs_dir) && fs.statSync(fetchResult.docs_dir).isDirectory()) {
    return path.resolve(fetchResult.docs_dir);
  }

  return snapshotDir;
}

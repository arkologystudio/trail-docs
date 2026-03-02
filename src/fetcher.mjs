import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CliError } from "./errors.mjs";
import { DEFAULTS, EXIT_CODES } from "./constants.mjs";
import { ensureDirForFile, hashText, toPosixPath } from "./utils.mjs";
import { docsPathFor, parseSelector, readManifestIfPresent, snapshotKey } from "./source-resolver.mjs";

const DEFAULT_ALLOWED_EXTENSIONS = [".md", ".markdown", ".mdx", ".txt"];

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

function ensureWithin(base, candidate) {
  const resolvedBase = path.resolve(base);
  const resolvedCandidate = path.resolve(candidate);
  if (!resolvedCandidate.startsWith(resolvedBase)) {
    throw new CliError(
      EXIT_CODES.POLICY_VIOLATION,
      "POLICY_VIOLATION",
      `Refusing to write outside snapshot directory: ${resolvedCandidate}`,
      "Use a dedicated fetch --out directory"
    );
  }
}

function resolvePolicy(policyPath = "") {
  const defaults = {
    allowed_hosts: [],
    blocked_hosts: [],
    allowed_extensions: DEFAULT_ALLOWED_EXTENSIONS,
    max_files: DEFAULTS.fetchMaxFiles,
    max_total_bytes: DEFAULTS.fetchMaxTotalBytes
  };

  const target = policyPath ? path.resolve(policyPath) : path.resolve("trail-docs.policy.json");
  if (!fs.existsSync(target)) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    return {
      allowed_hosts: Array.isArray(parsed.allowed_hosts) ? parsed.allowed_hosts : defaults.allowed_hosts,
      blocked_hosts: Array.isArray(parsed.blocked_hosts) ? parsed.blocked_hosts : defaults.blocked_hosts,
      allowed_extensions: Array.isArray(parsed.allowed_extensions)
        ? parsed.allowed_extensions.map((entry) => String(entry).toLowerCase())
        : defaults.allowed_extensions,
      max_files: toNumber(parsed.max_files, defaults.max_files),
      max_total_bytes: toNumber(parsed.max_total_bytes, defaults.max_total_bytes)
    };
  } catch {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `Invalid policy file: ${target}`,
      "Fix JSON syntax or remove the policy file"
    );
  }
}

function assertHostAllowed(rawUrl, policy) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `Invalid URL: ${rawUrl}`,
      "Pass a valid http(s) URL"
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (policy.blocked_hosts.some((entry) => String(entry).toLowerCase() === host)) {
    throw new CliError(
      EXIT_CODES.FETCH_BLOCKED,
      "FETCH_BLOCKED",
      `Blocked host by policy: ${host}`,
      "Update trail-docs.policy.json blocked_hosts"
    );
  }

  if (policy.allowed_hosts.length > 0 && !policy.allowed_hosts.some((entry) => String(entry).toLowerCase() === host)) {
    throw new CliError(
      EXIT_CODES.FETCH_BLOCKED,
      "FETCH_BLOCKED",
      `Host not in allowlist: ${host}`,
      "Update trail-docs.policy.json allowed_hosts"
    );
  }
}

async function fetchJson(url, policy) {
  assertHostAllowed(url, policy);
  const response = await fetch(url, {
    headers: {
      "user-agent": "trail-docs/0.1.0",
      accept: "application/json"
    }
  });

  if (response.status === 429) {
    throw new CliError(
      EXIT_CODES.FETCH_RATE_LIMITED,
      "FETCH_RATE_LIMITED",
      `Rate limited by upstream source: ${url}`,
      "Retry later or use local/cache sources"
    );
  }

  if (!response.ok) {
    throw new CliError(
      EXIT_CODES.RESOLUTION_FAILED,
      "RESOLUTION_FAILED",
      `Fetch failed (${response.status}) for ${url}`,
      "Verify selector/version or provider availability"
    );
  }

  return response.json();
}

async function downloadFile(url, targetPath, policy) {
  assertHostAllowed(url, policy);
  const response = await fetch(url, {
    headers: {
      "user-agent": "trail-docs/0.1.0"
    }
  });

  if (response.status === 429) {
    throw new CliError(
      EXIT_CODES.FETCH_RATE_LIMITED,
      "FETCH_RATE_LIMITED",
      `Rate limited by upstream source: ${url}`,
      "Retry later or use local/cache sources"
    );
  }

  if (!response.ok) {
    throw new CliError(
      EXIT_CODES.RESOLUTION_FAILED,
      "RESOLUTION_FAILED",
      `Download failed (${response.status}) for ${url}`,
      "Verify source URL and permissions"
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  ensureDirForFile(targetPath);
  fs.writeFileSync(targetPath, bytes);
}

function extractTarball(tarPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  try {
    execFileSync("tar", ["-xzf", tarPath, "-C", outDir, "--strip-components=1"]);
  } catch {
    throw new CliError(
      EXIT_CODES.RESOLUTION_FAILED,
      "RESOLUTION_FAILED",
      `Failed to extract archive: ${tarPath}`,
      "Ensure tar is installed and archive is valid"
    );
  }
}

function shouldSkipDirectory(name) {
  return [".git", "node_modules", ".trail-docs", ".next", "dist", "build"].includes(name);
}

function shouldIncludeFile(relativePath, policy) {
  const extension = path.extname(relativePath).toLowerCase();
  if (!policy.allowed_extensions.includes(extension)) {
    return false;
  }
  return true;
}

function collectSuspiciousPatterns(content) {
  const patterns = [
    /ignore\s+(all\s+)?previous\s+instructions?/i,
    /disregard\s+the\s+above/i,
    /exfiltrat(e|ion)/i,
    /send\s+.*(token|secret|key|credential)/i,
    /paste\s+your\s+(token|api\s*key|password)/i
  ];

  const matches = [];
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      matches.push(pattern.source);
    }
  }
  return matches;
}

function copyDocsFromDir(sourceDir, docsDir, policy) {
  const stack = [sourceDir];
  let filesCopied = 0;
  let totalBytes = 0;
  const suspiciousFiles = [];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relativePath = toPosixPath(path.relative(sourceDir, fullPath));

      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) {
          continue;
        }
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !shouldIncludeFile(relativePath, policy)) {
        continue;
      }

      const stat = fs.statSync(fullPath);
      totalBytes += stat.size;
      filesCopied += 1;

      if (filesCopied > policy.max_files) {
        throw new CliError(
          EXIT_CODES.POLICY_VIOLATION,
          "POLICY_VIOLATION",
          `Fetch exceeded max_files (${policy.max_files})`,
          "Adjust trail-docs.policy.json max_files"
        );
      }

      if (totalBytes > policy.max_total_bytes) {
        throw new CliError(
          EXIT_CODES.POLICY_VIOLATION,
          "POLICY_VIOLATION",
          `Fetch exceeded max_total_bytes (${policy.max_total_bytes})`,
          "Adjust trail-docs.policy.json max_total_bytes"
        );
      }

      const targetPath = path.resolve(docsDir, relativePath);
      ensureWithin(docsDir, targetPath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const content = fs.readFileSync(fullPath, "utf8");
      fs.writeFileSync(targetPath, content, "utf8");

      const suspicious = collectSuspiciousPatterns(content);
      if (suspicious.length > 0) {
        suspiciousFiles.push({
          path: relativePath,
          patterns: suspicious
        });
      }
    }
  }

  return {
    files_copied: filesCopied,
    total_bytes: totalBytes,
    suspicious_files: suspiciousFiles
  };
}

async function resolveNpmSource(parsed, flags, policy) {
  const pkg = parsed.package_name;
  const metadataUrl = `https://registry.npmjs.org/${encodeURIComponent(pkg)}`;
  const metadata = await fetchJson(metadataUrl, policy);

  const requestedRef = flags.version ? String(flags.version) : "latest";
  const version = flags.version ? String(flags.version) : metadata["dist-tags"]?.latest;
  if (!version || !metadata.versions?.[version]) {
    throw new CliError(
      EXIT_CODES.RESOLUTION_FAILED,
      "RESOLUTION_FAILED",
      `Could not resolve version for npm package ${pkg}`,
      "Pass --version <semver> or verify package availability"
    );
  }

  const packageVersion = metadata.versions[version];
  const tarballUrl = packageVersion.dist?.tarball;
  if (!tarballUrl) {
    throw new CliError(
      EXIT_CODES.RESOLUTION_FAILED,
      "RESOLUTION_FAILED",
      `No tarball URL for npm package ${pkg}@${version}`,
      "Use a different version"
    );
  }

  return {
    source_type: "registry",
    provider: "npm",
    library: pkg,
    requested_ref: requestedRef,
    resolved_ref: version,
    integrity: packageVersion.dist?.integrity || packageVersion.dist?.shasum || "",
    canonical_url: metadata.homepage || packageVersion.homepage || `https://www.npmjs.com/package/${pkg}`,
    archive_url: tarballUrl
  };
}

async function resolveGithubSource(parsed, flags, policy) {
  const owner = parsed.owner;
  const repo = parsed.repo;
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const metadata = await fetchJson(baseUrl, policy);
  const requestedRef = flags.ref ? String(flags.ref) : metadata.default_branch || "HEAD";

  const commit = await fetchJson(`${baseUrl}/commits/${encodeURIComponent(requestedRef)}`, policy);
  const sha = commit.sha;
  if (!sha) {
    throw new CliError(
      EXIT_CODES.RESOLUTION_FAILED,
      "RESOLUTION_FAILED",
      `Could not resolve commit SHA for github:${owner}/${repo}@${requestedRef}`,
      "Pass --ref <branch|tag|sha>"
    );
  }

  return {
    source_type: "github",
    provider: "github",
    library: `${owner}/${repo}`,
    requested_ref: requestedRef,
    resolved_ref: sha,
    integrity: sha,
    canonical_url: `https://github.com/${owner}/${repo}`,
    archive_url: `https://codeload.github.com/${owner}/${repo}/tar.gz/${sha}`
  };
}

async function resolveDocsUrlSource(parsed, policy) {
  const url = parsed.url;
  assertHostAllowed(url, policy);

  const extension = path.extname(new URL(url).pathname || "").toLowerCase();
  if (!DEFAULT_ALLOWED_EXTENSIONS.includes(extension)) {
    throw new CliError(
      EXIT_CODES.FETCH_BLOCKED,
      "FETCH_BLOCKED",
      `Only markdown/text URLs are supported for docs_url fetch: ${url}`,
      "Pass a .md URL or use repository/package selectors"
    );
  }

  return {
    source_type: "docs",
    provider: "url",
    library: new URL(url).hostname,
    requested_ref: "direct",
    resolved_ref: "direct",
    integrity: "",
    canonical_url: url,
    archive_url: ""
  };
}

async function resolveLocalSource(parsed) {
  const value = parsed.path;
  const isDirectory = parsed.type === "local_dir";
  const descriptor = isDirectory ? value : path.dirname(value);
  const stat = fs.statSync(value);
  const integrity = isDirectory ? hashText(`${value}:${stat.mtimeMs}`) : hashText(fs.readFileSync(value, "utf8"));

  return {
    source_type: "local",
    provider: "local",
    library: path.basename(descriptor),
    requested_ref: "local",
    resolved_ref: integrity.slice(0, 12),
    integrity,
    canonical_url: `file://${descriptor}`,
    archive_url: "",
    local_path: value,
    local_is_directory: isDirectory
  };
}

function cleanDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeSourceManifest(snapshotDir, payload) {
  const sourceManifestPath = path.join(snapshotDir, ".trail-docs", "source.json");
  ensureDirForFile(sourceManifestPath);
  fs.writeFileSync(sourceManifestPath, JSON.stringify(payload, null, 2), "utf8");
  return sourceManifestPath;
}

function createTempDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trail-docs-fetch-"));
  return root;
}

async function materializeSource(source, snapshotDir, policy) {
  const docsDir = docsPathFor(snapshotDir);
  const rawDir = path.join(snapshotDir, "raw");
  fs.mkdirSync(docsDir, { recursive: true });

  if (source.source_type === "local") {
    if (source.local_is_directory) {
      return copyDocsFromDir(source.local_path, docsDir, policy);
    }

    const target = path.join(docsDir, path.basename(source.local_path));
    ensureWithin(docsDir, target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = fs.readFileSync(source.local_path, "utf8");
    fs.writeFileSync(target, content, "utf8");
    return {
      files_copied: 1,
      total_bytes: Buffer.byteLength(content, "utf8"),
      suspicious_files: collectSuspiciousPatterns(content).length
        ? [{ path: path.basename(source.local_path), patterns: collectSuspiciousPatterns(content) }]
        : []
    };
  }

  if (source.source_type === "docs") {
    const target = path.join(docsDir, path.basename(new URL(source.canonical_url).pathname || "index.md") || "index.md");
    await downloadFile(source.canonical_url, target, policy);
    const content = fs.readFileSync(target, "utf8");
    return {
      files_copied: 1,
      total_bytes: Buffer.byteLength(content, "utf8"),
      suspicious_files: collectSuspiciousPatterns(content).length
        ? [{ path: path.basename(target), patterns: collectSuspiciousPatterns(content) }]
        : []
    };
  }

  const tmpRoot = createTempDir();
  const tarPath = path.join(tmpRoot, "archive.tgz");
  try {
    await downloadFile(source.archive_url, tarPath, policy);
    fs.mkdirSync(rawDir, { recursive: true });
    extractTarball(tarPath, rawDir);
    return copyDocsFromDir(rawDir, docsDir, policy);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

export async function fetchLibrarySource({ selector, flags = {} }) {
  const parsed = parseSelector(selector);
  if (!parsed) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      "Missing selector for fetch",
      "Usage: trail-docs fetch <selector>"
    );
  }
  const policy = resolvePolicy(flags.policy ? String(flags.policy) : "");
  let source;

  if (parsed.type === "npm") {
    source = await resolveNpmSource(parsed, flags, policy);
  } else if (parsed.type === "github") {
    source = await resolveGithubSource(parsed, flags, policy);
  } else if (parsed.type === "docs_url") {
    source = await resolveDocsUrlSource(parsed, policy);
  } else {
    source = await resolveLocalSource(parsed);
  }

  const cacheRoot = flags["cache-dir"] ? path.resolve(String(flags["cache-dir"])) : path.resolve(".trail-docs", "cache", "sources");
  const outRoot = flags.out ? path.resolve(String(flags.out)) : cacheRoot;

  let snapshotDir;
  if (flags.out) {
    snapshotDir = outRoot;
  } else {
    const key = snapshotKey(source);
    snapshotDir = path.join(outRoot, key);
  }

  const cached = readManifestIfPresent(snapshotDir);
  if (cached) {
    return {
      ok: true,
      selector,
      library: cached.manifest.library,
      version: cached.manifest.resolved_ref,
      source_type: cached.manifest.source_type,
      canonical_url: cached.manifest.canonical_url,
      requested_ref: cached.manifest.requested_ref,
      resolved_ref: cached.manifest.resolved_ref,
      integrity: cached.manifest.integrity,
      snapshot_dir: cached.manifest.snapshot_dir,
      docs_dir: cached.manifest.docs_dir,
      source_manifest_path: cached.manifest_path,
      files_copied: cached.manifest.files_copied,
      total_bytes: cached.manifest.total_bytes,
      trust_signals: cached.manifest.trust_signals,
      cache_hit: true
    };
  }

  if (fs.existsSync(snapshotDir) && fs.readdirSync(snapshotDir).length > 0) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `Fetch output directory is not empty: ${snapshotDir}`,
      "Pass --out to an empty directory or remove existing files"
    );
  }

  cleanDir(snapshotDir);
  const materialized = await materializeSource(source, snapshotDir, policy);

  const manifestPayload = {
    schema_version: "1",
    library: source.library,
    source_type: source.source_type,
    provider: source.provider,
    selector,
    canonical_url: source.canonical_url,
    requested_ref: source.requested_ref,
    resolved_ref: source.resolved_ref,
    integrity: source.integrity,
    fetched_at: new Date().toISOString(),
    snapshot_dir: snapshotDir,
    docs_dir: docsPathFor(snapshotDir),
    files_copied: materialized.files_copied,
    total_bytes: materialized.total_bytes,
    trust_signals: {
      suspicious_count: materialized.suspicious_files.length,
      suspicious_files: materialized.suspicious_files
    }
  };

  const sourceManifestPath = writeSourceManifest(snapshotDir, manifestPayload);

  return {
    ok: true,
    selector,
    library: source.library,
    version: source.resolved_ref,
    source_type: source.source_type,
    canonical_url: source.canonical_url,
    requested_ref: source.requested_ref,
    resolved_ref: source.resolved_ref,
    integrity: source.integrity,
    snapshot_dir: snapshotDir,
    docs_dir: docsPathFor(snapshotDir),
    source_manifest_path: sourceManifestPath,
    files_copied: materialized.files_copied,
    total_bytes: materialized.total_bytes,
    trust_signals: manifestPayload.trust_signals,
    cache_hit: false
  };
}

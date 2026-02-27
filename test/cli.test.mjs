import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const REPO_ROOT = process.cwd();
const CLI_PATH = path.join(REPO_ROOT, "src", "cli.mjs");
const FIXTURE_DOCS = path.join(REPO_ROOT, "fixtures", "docs");
const FIXTURE_CODEBASE = path.join(REPO_ROOT, "fixtures", "codebase");

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doccli-test-"));
}

function runCli(args, cwd) {
  const result = spawnSync("node", [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8"
  });

  return {
    code: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function setupDocs(tmpDir) {
  const docsDir = path.join(tmpDir, "docs");
  fs.cpSync(FIXTURE_DOCS, docsDir, { recursive: true });
  return docsDir;
}

function setupCodebase(tmpDir) {
  const codeDir = path.join(tmpDir, "project");
  fs.cpSync(FIXTURE_CODEBASE, codeDir, { recursive: true });
  return codeDir;
}

test("build generates deterministic index hash", () => {
  const tmpDir = makeTmpDir();
  setupDocs(tmpDir);

  const build1 = runCli(
    ["build", "--src", "docs", "--library", "acme-payments", "--version", "2.4.1", "--json"],
    tmpDir
  );
  assert.equal(build1.code, 0);
  const payload1 = JSON.parse(build1.stdout);

  const build2 = runCli(
    ["build", "--src", "docs", "--library", "acme-payments", "--version", "2.4.1", "--json"],
    tmpDir
  );
  assert.equal(build2.code, 0);
  const payload2 = JSON.parse(build2.stdout);

  assert.equal(payload1.source_hash, payload2.source_hash);
  assert.equal(payload1.docs_count, 2);
  assert.ok(payload1.sections_count >= 3);
});

test("search, open, and cite return expected fields", () => {
  const tmpDir = makeTmpDir();
  setupDocs(tmpDir);

  const build = runCli(
    ["build", "--src", "docs", "--library", "acme-payments", "--version", "2.4.1", "--json"],
    tmpDir
  );
  assert.equal(build.code, 0);

  const search = runCli(["search", "refresh token", "--json"], tmpDir);
  assert.equal(search.code, 0);
  const searchPayload = JSON.parse(search.stdout);
  assert.ok(searchPayload.results.length > 0);
  assert.equal(searchPayload.results[0].doc_id, "auth/oauth");
  assert.equal(searchPayload.results[0].anchor, "refresh-token");

  const open = runCli(["open", "auth/oauth#refresh-token", "--json"], tmpDir);
  assert.equal(open.code, 0);
  const openPayload = JSON.parse(open.stdout);
  assert.equal(openPayload.doc_id, "auth/oauth");
  assert.equal(openPayload.anchor, "refresh-token");
  assert.ok(openPayload.content.includes("refresh token"));

  const cite = runCli(["cite", "auth/oauth#refresh-token", "--json"], tmpDir);
  assert.equal(cite.code, 0);
  const citePayload = JSON.parse(cite.stdout);
  assert.ok(citePayload.citation_id.includes("auth/oauth#refresh-token"));
});

test("list and stats expose index coverage metadata", () => {
  const tmpDir = makeTmpDir();
  setupDocs(tmpDir);

  const build = runCli(
    ["build", "--src", "docs", "--library", "acme-payments", "--version", "2.4.1", "--json"],
    tmpDir
  );
  assert.equal(build.code, 0);

  const list = runCli(["list", "--json"], tmpDir);
  assert.equal(list.code, 0);
  const listPayload = JSON.parse(list.stdout);
  assert.ok(Array.isArray(listPayload.docs));
  assert.ok(listPayload.docs.length > 0);
  assert.ok(typeof listPayload.docs[0].sections === "number");

  const stats = runCli(["stats", "--json"], tmpDir);
  assert.equal(stats.code, 0);
  const statsPayload = JSON.parse(stats.stdout);
  assert.equal(statsPayload.docs_count, 2);
  assert.ok(statsPayload.sections_count >= 3);
  assert.ok(typeof statsPayload.sections_per_doc === "number");
});

test("use resolves package manifest and returns citation-backed steps", () => {
  const tmpDir = makeTmpDir();
  setupDocs(tmpDir);

  const build = runCli(
    ["build", "--src", "docs", "--library", "acme-payments", "--version", "2.4.1", "--json"],
    tmpDir
  );
  assert.equal(build.code, 0);

  const packageRoot = path.join(tmpDir, "node_modules", "acme-payments");
  const indexDir = path.join(packageRoot, ".doccli");
  fs.mkdirSync(indexDir, { recursive: true });
  fs.copyFileSync(path.join(tmpDir, ".doccli", "index.json"), path.join(indexDir, "index.json"));
  fs.writeFileSync(
    path.join(packageRoot, "doccli.json"),
    JSON.stringify(
      {
        schema_version: "1",
        library: "acme-payments",
        library_version: "2.4.1",
        index_path: ".doccli/index.json",
        built_at: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );

  const use = runCli(
    ["use", "acme-payments", "set up webhook signature verification", "--json"],
    tmpDir
  );
  assert.equal(use.code, 0);
  const usePayload = JSON.parse(use.stdout);
  assert.equal(usePayload.confidence, "authoritative");
  assert.ok(usePayload.steps.length > 0);
  assert.ok(usePayload.steps.every((step) => step.citations.length > 0));
  assert.ok(usePayload.steps.every((step) => typeof step.confidence === "number"));
  assert.ok(usePayload.steps.some((step) => typeof step.command === "string" && step.command.length > 0));
  assert.ok(Array.isArray(usePayload.related_docs));
});

test("use resolves manifest when --path points at .doccli directory", () => {
  const tmpDir = makeTmpDir();
  setupDocs(tmpDir);

  const build = runCli(
    ["build", "--src", "docs", "--library", "acme-payments", "--version", "2.4.1", "--json"],
    tmpDir
  );
  assert.equal(build.code, 0);

  const manifestPath = path.join(tmpDir, ".doccli", "doccli.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        schema_version: "1",
        library: "acme-payments",
        library_version: "2.4.1",
        index_path: "index.json",
        built_at: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );

  const use = runCli(
    ["use", "acme-payments", "refresh token flow", "--path", ".doccli", "--json"],
    tmpDir
  );
  assert.equal(use.code, 0);
  const payload = JSON.parse(use.stdout);
  assert.equal(payload.library, "acme-payments");
  assert.ok(payload.steps.length > 0);
});

test("missing reference returns deterministic error code", () => {
  const tmpDir = makeTmpDir();
  setupDocs(tmpDir);

  const build = runCli(
    ["build", "--src", "docs", "--library", "acme-payments", "--version", "2.4.1", "--json"],
    tmpDir
  );
  assert.equal(build.code, 0);

  const missing = runCli(["open", "auth/oauth#does-not-exist", "--json"], tmpDir);
  assert.equal(missing.code, 5);
  const payload = JSON.parse(missing.stdout);
  assert.equal(payload.error.code, "REF_NOT_FOUND");
});

test("bootstrap generates docs and searchable index from codebase", () => {
  const tmpDir = makeTmpDir();
  setupCodebase(tmpDir);

  const bootstrap = runCli(
    [
      "bootstrap",
      "--src",
      "project",
      "--library",
      "acme-runtime",
      "--version",
      "0.0.0-derived",
      "--json"
    ],
    tmpDir
  );
  assert.equal(bootstrap.code, 0);
  const bootstrapPayload = JSON.parse(bootstrap.stdout);
  assert.equal(bootstrapPayload.confidence, "partial");
  assert.ok(bootstrapPayload.source_files_scanned >= 1);
  assert.ok(fs.existsSync(path.join(tmpDir, ".doccli", "generated-docs", "bootstrap.md")));
  assert.ok(fs.existsSync(path.join(tmpDir, ".doccli", "index.json")));

  const search = runCli(["search", "ACME_WEBHOOK_SECRET", "--json"], tmpDir);
  assert.equal(search.code, 0);
  const searchPayload = JSON.parse(search.stdout);
  assert.ok(searchPayload.results.length > 0);
  assert.equal(searchPayload.library, "acme-runtime");
});

test("bootstrap emit-manifest enables immediate use resolution", () => {
  const tmpDir = makeTmpDir();
  setupCodebase(tmpDir);

  const bootstrap = runCli(
    [
      "bootstrap",
      "--src",
      "project",
      "--library",
      "acme-runtime",
      "--version",
      "0.0.1-derived",
      "--emit-manifest",
      "--json"
    ],
    tmpDir
  );
  assert.equal(bootstrap.code, 0);
  const bootstrapPayload = JSON.parse(bootstrap.stdout);
  assert.ok(bootstrapPayload.manifest_path);
  assert.ok(fs.existsSync(path.join(tmpDir, "doccli.json")));

  const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, "doccli.json"), "utf8"));
  assert.equal(manifest.library, "acme-runtime");
  assert.equal(manifest.library_version, "0.0.1-derived");
  assert.ok(manifest.index_path.endsWith(".doccli/index.json"));

  const use = runCli(["use", "acme-runtime", "webhook signature validation", "--path", tmpDir, "--json"], tmpDir);
  assert.equal(use.code, 0);
  const usePayload = JSON.parse(use.stdout);
  assert.equal(usePayload.library, "acme-runtime");
});

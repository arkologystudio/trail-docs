import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { retrieveWithTrailDocs } from "../eval/src/adapters/trail-docs.mjs";
import { retrieveWithGrep } from "../eval/src/adapters/grep.mjs";
import { normalizeContext7Payload, retrieveWithContext7 } from "../eval/src/adapters/context7.mjs";

const REPO_ROOT = process.cwd();

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "trail-docs-eval-adapter-"));
}

function setupFixtureDocs(tmpDir) {
  const docsDir = path.join(tmpDir, "docs");
  fs.cpSync(path.join(REPO_ROOT, "fixtures", "docs"), docsDir, { recursive: true });
  return docsDir;
}

function setupCorpusForTrailDocs(tmpDir) {
  const docsDir = setupFixtureDocs(tmpDir);
  const outDir = path.join(tmpDir, ".trail-docs");
  fs.mkdirSync(outDir, { recursive: true });
  const indexPath = path.join(outDir, "index.json");
  const manifestPath = path.join(outDir, "trail-docs.json");

  const cliPath = path.join(REPO_ROOT, "src", "cli.mjs");
  const build = spawnSync(
    "node",
    [
      cliPath,
      "build",
      "--src",
      docsDir,
      "--library",
      "acme-payments",
      "--version",
      "2.4.1",
      "--out",
      indexPath,
      "--json"
    ],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );

  assert.equal(build.status, 0);

  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        schema_version: "1",
        library: "acme-payments",
        library_version: "2.4.1",
        index_path: "index.json",
        built_at: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return {
    docsDir,
    corpus: {
      library: "acme-payments",
      manifest_dir: outDir,
      index_path: indexPath,
      docs_dir: docsDir
    }
  };
}

test("trail-docs adapter returns normalized context blocks", () => {
  const tmpDir = makeTmpDir();
  const { corpus } = setupCorpusForTrailDocs(tmpDir);

  const result = retrieveWithTrailDocs({
    benchCase: {
      question: "How do I use refresh tokens?"
    },
    corpus,
    limits: { max_blocks: 3 },
    repoRoot: REPO_ROOT
  });

  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.context_blocks));
  assert.ok(result.context_blocks.length > 0);
  assert.ok(typeof result.context_blocks[0].text === "string");
});

test("grep adapter returns snippets with citations", () => {
  const tmpDir = makeTmpDir();
  const docsDir = setupFixtureDocs(tmpDir);

  const result = retrieveWithGrep({
    benchCase: { question: "signature validation" },
    corpus: { docs_dir: docsDir },
    limits: { max_blocks: 4, grep_window_lines: 4 }
  });

  assert.equal(result.ok, true);
  assert.ok(result.context_blocks.length > 0);
  assert.ok(result.context_blocks[0].citation.includes(":"));
});

test("context7 adapter normalizes payload and supports cmd mode", async () => {
  const normalized = normalizeContext7Payload({
    results: [{ content: "alpha", source: "doc.md:10-12" }]
  });
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].citation, "doc.md:10-12");

  const previousMode = process.env.CONTEXT7_MODE;
  const previousCmd = process.env.CONTEXT7_CMD;

  process.env.CONTEXT7_MODE = "cmd";
  process.env.CONTEXT7_CMD = "printf '%s' '{\"context_blocks\":[{\"text\":\"hello\",\"citation\":\"doc.md:1-2\"}]}'";

  const result = await retrieveWithContext7({
    benchCase: { question: "test" },
    corpus: { docs_dir: REPO_ROOT },
    limits: { max_blocks: 3 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.context_blocks.length, 1);

  process.env.CONTEXT7_MODE = previousMode;
  process.env.CONTEXT7_CMD = previousCmd;
});

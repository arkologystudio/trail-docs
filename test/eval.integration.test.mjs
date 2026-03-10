import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = process.cwd();

test("smoke eval runs end-to-end and writes artifacts", () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "trail-docs-eval-run-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "trail-docs-eval-config-"));
  const runId = `test-smoke-${Date.now()}`;
  const casesPath = path.join(configDir, "cases.jsonl");
  const configPath = path.join(configDir, "config.json");

  fs.writeFileSync(
    casesPath,
    [
      JSON.stringify({
        id: "integration_case_local_docs",
        profile: "smoke",
        corpus: "fixtures_docs",
        question: "How do I use refresh token flow?",
        required_points: ["refresh token"],
        acceptable_citations: ["auth/oauth"],
        forbidden_claims: ["client credentials only"],
        max_context_tokens: 1000
      })
    ].join("\n"),
    "utf8"
  );

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        schema_version: "1",
        profiles: {
          smoke: {
            cases_file: casesPath,
            passes: 1
          }
        },
        tools: ["trail-docs", "grep", "context7"],
        corpora: [
          {
            id: "fixtures_docs",
            type: "local_docs",
            src: path.join(REPO_ROOT, "fixtures", "docs"),
            library: "acme-payments",
            version: "2.4.1"
          }
        ],
        limits: {
          max_context_tokens: 1000,
          max_blocks: 4,
          grep_window_lines: 4
        },
        answerer: {
          provider: "mock",
          model: "mock-v1",
          temperature: 0,
          max_output_tokens: 200
        },
        judge: {
          provider: "mock",
          model: "mock-v1",
          temperature: 0,
          max_output_tokens: 120
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const result = spawnSync(
    "node",
    [
      path.join(REPO_ROOT, "eval", "src", "run-eval.mjs"),
      "--profile",
      "smoke",
      "--config",
      configPath,
      "--allow-missing-context7",
      "--out-dir",
      outDir,
      "--run-id",
      runId
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        EVAL_MODEL_PROVIDER: "mock",
        EVAL_JUDGE_PROVIDER: "mock",
        CONTEXT7_MODE: "cmd",
        CONTEXT7_CMD: ""
      }
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(String(result.stdout || "{}"));

  assert.equal(payload.ok, true);
  assert.ok(fs.existsSync(payload.raw));
  assert.ok(fs.existsSync(payload.summary));
  assert.ok(fs.existsSync(payload.report));

  const rawRows = fs
    .readFileSync(payload.raw, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.ok(rawRows.length >= 3);
  assert.ok(rawRows.some((entry) => entry.tool === "trail-docs"));
  assert.ok(rawRows.some((entry) => entry.tool === "grep"));
  assert.ok(rawRows.some((entry) => entry.tool === "context7"));
});

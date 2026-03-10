import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { generateAnswer, judgeAnswer } from "./answerer.mjs";
import {
  extractAnswerCitations,
  finalComprehensionScore,
  scoreCitations,
  scoreForbiddenClaims,
  scoreRequiredPoints
} from "./scoring.mjs";
import { countTokens, trimBlocksToTokenBudget } from "./tokenizer.mjs";
import { buildSummary, toMarkdown } from "./report.mjs";
import { retrieveWithTrailDocs } from "./adapters/trail-docs.mjs";
import { retrieveWithGrep } from "./adapters/grep.mjs";
import { retrieveWithContext7 } from "./adapters/context7.mjs";

function parseArgs(argv) {
  const args = {
    profile: "smoke",
    configPath: "eval/config/eval.config.json",
    outDir: "eval/results",
    allowMissingContext7: false,
    refreshCorpora: false,
    runId: ""
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--profile") {
      args.profile = argv[i + 1] || args.profile;
      i += 1;
    } else if (token === "--config") {
      args.configPath = argv[i + 1] || args.configPath;
      i += 1;
    } else if (token === "--out-dir") {
      args.outDir = argv[i + 1] || args.outDir;
      i += 1;
    } else if (token === "--allow-missing-context7") {
      args.allowMissingContext7 = true;
    } else if (token === "--refresh-corpora") {
      args.refreshCorpora = true;
    } else if (token === "--run-id") {
      args.runId = argv[i + 1] || "";
      i += 1;
    }
  }

  return args;
}

function createRunId(profile) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${profile}-${stamp}`;
}

function loadConfig(configPath) {
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function loadCases(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolvePath(repoRoot, value) {
  if (!value) {
    return "";
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(repoRoot, value);
}

function runCliJson(repoRoot, args) {
  const cliPath = path.join(repoRoot, "src", "cli.mjs");
  const result = spawnSync("node", [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  const status = Number.isFinite(result.status) ? result.status : 1;
  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();

  let payload = null;
  if (stdout) {
    try {
      payload = JSON.parse(stdout);
    } catch {
      payload = null;
    }
  }

  return { status, stdout, stderr, payload };
}

function writeManifest({ manifestPath, library, version, indexPath }) {
  const payload = {
    schema_version: "2",
    library,
    library_version: version,
    index_path: path.relative(path.dirname(manifestPath), indexPath).split(path.sep).join("/"),
    built_at: new Date().toISOString()
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function toCorpusRecord({ id, library, version, manifestDir, indexPath, docsDir, sourceType }) {
  return {
    id,
    source_type: sourceType,
    library,
    version,
    manifest_dir: manifestDir,
    index_path: indexPath,
    docs_dir: docsDir
  };
}

function prepareLocalDocsCorpus({ repoRoot, cacheRoot, definition }) {
  const outDir = path.join(cacheRoot, definition.id);
  ensureDir(outDir);

  const srcDir = resolvePath(repoRoot, definition.src);
  const indexPath = path.join(outDir, "index.json");
  const manifestPath = path.join(outDir, "trail-docs.json");
  const library = definition.library || definition.id;
  const version = definition.version || "workspace";

  const build = runCliJson(repoRoot, [
    "build",
    "--src",
    srcDir,
    "--library",
    library,
    "--version",
    version,
    "--out",
    indexPath,
    "--json"
  ]);
  if (build.status !== 0) {
    throw new Error(`Failed to build corpus ${definition.id}: ${build.stderr || build.stdout}`);
  }

  writeManifest({ manifestPath, library, version, indexPath });
  return toCorpusRecord({
    id: definition.id,
    library,
    version,
    manifestDir: outDir,
    indexPath,
    docsDir: srcDir,
    sourceType: "local_docs"
  });
}

function prepareLocalCodebaseCorpus({ repoRoot, cacheRoot, definition }) {
  const outDir = path.join(cacheRoot, definition.id);
  ensureDir(outDir);

  const srcDir = resolvePath(repoRoot, definition.src);
  const docsOut = path.join(outDir, "generated-docs");
  const indexPath = path.join(outDir, "index.json");
  const manifestPath = path.join(outDir, "trail-docs.json");
  const library = definition.library || definition.id;
  const version = definition.version || "derived";

  const bootstrap = runCliJson(repoRoot, [
    "bootstrap",
    "--src",
    srcDir,
    "--library",
    library,
    "--version",
    version,
    "--docs-out",
    docsOut,
    "--out",
    indexPath,
    "--emit-manifest",
    "--manifest-out",
    manifestPath,
    "--json"
  ]);

  if (bootstrap.status !== 0) {
    throw new Error(`Failed to bootstrap corpus ${definition.id}: ${bootstrap.stderr || bootstrap.stdout}`);
  }

  const grepDocsDir = definition.grep_src ? resolvePath(repoRoot, definition.grep_src) : srcDir;
  return toCorpusRecord({
    id: definition.id,
    library,
    version,
    manifestDir: outDir,
    indexPath,
    docsDir: grepDocsDir,
    sourceType: "local_codebase_bootstrap"
  });
}

function loadExternalMeta(metaPath) {
  if (!fs.existsSync(metaPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
}

function prepareExternalSelectorCorpus({ repoRoot, cacheRoot, definition, refreshCorpora }) {
  const outDir = path.join(cacheRoot, definition.id);
  ensureDir(outDir);

  const manifestPath = path.join(outDir, "trail-docs.json");
  const indexPath = path.join(outDir, "index.json");
  const metaPath = path.join(outDir, "corpus-meta.json");

  if (!refreshCorpora) {
    const cachedMeta = loadExternalMeta(metaPath);
    if (
      cachedMeta &&
      fs.existsSync(manifestPath) &&
      fs.existsSync(indexPath) &&
      cachedMeta.docs_dir &&
      fs.existsSync(cachedMeta.docs_dir)
    ) {
      return toCorpusRecord({
        id: definition.id,
        library: cachedMeta.library || definition.library || definition.id,
        version: cachedMeta.version || definition.version || "cached",
        manifestDir: outDir,
        indexPath,
        docsDir: cachedMeta.docs_dir,
        sourceType: "external_selector"
      });
    }
  }

  const args = ["prep", definition.selector, "--path", outDir, "--json"];
  if (definition.library) {
    args.push("--library", definition.library);
  }
  if (definition.version) {
    args.push("--version", definition.version);
  }
  if (definition.ref) {
    args.push("--ref", definition.ref);
  }

  const prepared = runCliJson(repoRoot, args);
  if (prepared.status !== 0) {
    throw new Error(`Failed to prep corpus ${definition.id}: ${prepared.stderr || prepared.stdout}`);
  }

  const payload = prepared.payload || {};
  const docsDir = resolvePath(repoRoot, payload.docs_dir || "");
  const library = definition.library || payload.library || definition.id;
  const version = definition.version || payload.version || payload?.source?.resolved_ref || "external";

  fs.writeFileSync(
    metaPath,
    `${JSON.stringify(
      {
        id: definition.id,
        selector: definition.selector,
        library,
        version,
        docs_dir: docsDir,
        manifest_path: payload.manifest_path || manifestPath,
        index_path: payload.index_path || indexPath,
        prepared_at: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return toCorpusRecord({
    id: definition.id,
    library,
    version,
    manifestDir: outDir,
    indexPath,
    docsDir,
    sourceType: "external_selector"
  });
}

function prepareCorpora({ repoRoot, config, refreshCorpora }) {
  const cacheRoot = path.join(repoRoot, "eval", ".cache");
  ensureDir(cacheRoot);

  const definitions = Array.isArray(config.corpora) ? config.corpora : [];
  if (definitions.length === 0) {
    throw new Error("No corpus definitions found in config.corpora");
  }

  const corpora = {};
  for (const definition of definitions) {
    if (!definition?.id || !definition?.type) {
      throw new Error("Each corpus requires id and type");
    }

    if (definition.type === "local_docs") {
      corpora[definition.id] = prepareLocalDocsCorpus({ repoRoot, cacheRoot, definition });
      continue;
    }
    if (definition.type === "local_codebase_bootstrap") {
      corpora[definition.id] = prepareLocalCodebaseCorpus({ repoRoot, cacheRoot, definition });
      continue;
    }
    if (definition.type === "external_selector") {
      corpora[definition.id] = prepareExternalSelectorCorpus({
        repoRoot,
        cacheRoot,
        definition,
        refreshCorpora
      });
      continue;
    }

    throw new Error(`Unsupported corpus type: ${definition.type}`);
  }

  return corpora;
}

async function retrieveForTool({ tool, benchCase, corpus, limits, repoRoot }) {
  if (tool === "trail-docs") {
    return retrieveWithTrailDocs({ benchCase, corpus, limits, repoRoot });
  }
  if (tool === "grep") {
    return retrieveWithGrep({ benchCase, corpus, limits });
  }
  if (tool === "context7") {
    return retrieveWithContext7({ benchCase, corpus, limits });
  }
  return {
    ok: false,
    context_blocks: [],
    retrieval_meta: { latency_ms: 0, command_count: 0, raw_bytes: 0 },
    error: `Unknown tool: ${tool}`
  };
}

function buildErrorRecord({ runId, profile, passIndex, tool, benchCase, startedAt, error, retrievalMeta = null, skipped = false }) {
  return {
    run_id: runId,
    timestamp: startedAt,
    profile,
    tool,
    case_id: benchCase.id,
    pass_index: passIndex,
    retrieval_latency_ms: retrievalMeta?.latency_ms || 0,
    answer_latency_ms: 0,
    total_latency_ms: retrievalMeta?.latency_ms || 0,
    retrieval_tokens: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    answer_text: "",
    answer_citations: [],
    first_hop_precision_at_k: Number(retrievalMeta?.first_hop_precision_at_k || 0),
    coverage_after_2_hops: Number(retrievalMeta?.coverage_after_2_hops || 0),
    coverage_after_3_hops: Number(retrievalMeta?.coverage_after_3_hops || 0),
    tokens_per_required_point: 0,
    duplicate_context_ratio: Number(retrievalMeta?.duplicate_context_ratio || 0),
    citation_precision_line_level: Number(retrievalMeta?.citation_precision_line_level || 0),
    abstain_when_unknown_rate: Number(retrievalMeta?.abstain_when_unknown_rate || 0),
    required_points_score: 0,
    citation_score: 0,
    forbidden_claims_penalty: 0,
    judge_score: 0,
    comprehension_score: 0,
    ok: false,
    skipped,
    error: String(error || "Unknown error")
  };
}

async function evaluateRecord({ runId, profile, passIndex, tool, benchCase, corpus, config, limits, repoRoot }) {
  const startedAt = new Date().toISOString();
  const totalStarted = performance.now();

  try {
    const retrieval = await retrieveForTool({ tool, benchCase, corpus, limits, repoRoot });
    const retrievalMeta = retrieval.retrieval_meta || { latency_ms: 0, command_count: 0, raw_bytes: 0 };

    if (!retrieval.ok) {
      return buildErrorRecord({
        runId,
        profile,
        passIndex,
        tool,
        benchCase,
        startedAt,
        retrievalMeta,
        skipped: Boolean(retrieval.skipped),
        error: retrieval.error || `${tool} retrieval failed`
      });
    }

    const maxContextTokens = Number.isFinite(benchCase.max_context_tokens)
      ? benchCase.max_context_tokens
      : limits.max_context_tokens;
    const contextBlocks = trimBlocksToTokenBudget(retrieval.context_blocks || [], maxContextTokens);
    const retrievalTokens = contextBlocks.reduce(
      (sum, block) => sum + countTokens(block.text || "") + countTokens(block.citation || ""),
      0
    );

    const answerStarted = performance.now();
    const answer = await generateAnswer({
      question: benchCase.question,
      contextBlocks,
      config: config.answerer
    });
    const answerEnded = performance.now();

    const answerText = String(answer.text || "").trim();
    const answerCitations = extractAnswerCitations(answerText);

    const judge = await judgeAnswer({
      question: benchCase.question,
      answerText,
      contextBlocks,
      benchCase,
      config: config.judge
    });

    const required = scoreRequiredPoints(answerText, benchCase.required_points || []);
    const citations = scoreCitations(answerCitations, benchCase.acceptable_citations || [], answerText);
    const forbidden = scoreForbiddenClaims(answerText, benchCase.forbidden_claims || []);
    const tokensPerRequiredPoint = required.hits > 0 ? Number((retrievalTokens / required.hits).toFixed(4)) : 0;

    const comprehension = finalComprehensionScore({
      requiredPointsScore: required.score,
      citationScore: citations.score,
      judgeScore: Number(judge.judge_score || 0),
      forbiddenClaimsPenalty: forbidden.penalty
    });

    const promptTokens = Number(answer?.usage?.prompt_tokens || 0);
    const completionTokens = Number(answer?.usage?.completion_tokens || 0);
    const answerLatency = Number((answerEnded - answerStarted).toFixed(2));
    const totalLatency = Number((performance.now() - totalStarted).toFixed(2));

    return {
      run_id: runId,
      timestamp: startedAt,
      profile,
      tool,
      case_id: benchCase.id,
      pass_index: passIndex,
      retrieval_latency_ms: Number(retrievalMeta.latency_ms || 0),
      answer_latency_ms: answerLatency,
      total_latency_ms: totalLatency,
      retrieval_tokens: retrievalTokens,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: retrievalTokens + promptTokens + completionTokens,
      answer_text: answerText,
      answer_citations: answerCitations,
      first_hop_precision_at_k: Number(retrievalMeta.first_hop_precision_at_k || 0),
      coverage_after_2_hops: Number(retrievalMeta.coverage_after_2_hops || 0),
      coverage_after_3_hops: Number(retrievalMeta.coverage_after_3_hops || 0),
      tokens_per_required_point: tokensPerRequiredPoint,
      duplicate_context_ratio: Number(retrievalMeta.duplicate_context_ratio || 0),
      citation_precision_line_level: Number(retrievalMeta.citation_precision_line_level || 0),
      abstain_when_unknown_rate: Number(retrievalMeta.abstain_when_unknown_rate || 0),
      required_points_score: required.score,
      citation_score: citations.score,
      forbidden_claims_penalty: forbidden.penalty,
      judge_score: Number(judge.judge_score || 0),
      comprehension_score: comprehension,
      ok: true,
      skipped: false,
      error: ""
    };
  } catch (error) {
    return buildErrorRecord({
      runId,
      profile,
      passIndex,
      tool,
      benchCase,
      startedAt,
      error: error?.message || String(error)
    });
  }
}

async function main() {
  const repoRoot = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(path.resolve(repoRoot, args.configPath));

  const profileConfig = config.profiles?.[args.profile];
  if (!profileConfig) {
    throw new Error(`Unknown profile: ${args.profile}`);
  }

  const runId = args.runId || createRunId(args.profile);
  const outDir = path.resolve(repoRoot, args.outDir);
  ensureDir(outDir);

  const casesPath = path.resolve(repoRoot, profileConfig.cases_file);
  const benchCases = loadCases(casesPath);
  const tools = Array.isArray(config.tools) ? config.tools : ["trail-docs", "grep", "context7"];
  const limits = config.limits || {};
  const passes = Number.isFinite(profileConfig.passes) ? profileConfig.passes : 1;

  const corpora = prepareCorpora({ repoRoot, config, refreshCorpora: args.refreshCorpora });
  const records = [];

  for (let passIndex = 1; passIndex <= passes; passIndex += 1) {
    for (const benchCase of benchCases) {
      const corpus = corpora[benchCase.corpus];
      if (!corpus) {
        records.push(
          buildErrorRecord({
            runId,
            profile: args.profile,
            passIndex,
            tool: "all",
            benchCase,
            startedAt: new Date().toISOString(),
            error: `Unknown corpus: ${benchCase.corpus}`
          })
        );
        continue;
      }

      for (const tool of tools) {
        const record = await evaluateRecord({
          runId,
          profile: args.profile,
          passIndex,
          tool,
          benchCase,
          corpus,
          config,
          limits,
          repoRoot
        });

        if (
          tool === "context7" &&
          record.ok === false &&
          record.skipped === true &&
          args.profile === "full" &&
          !args.allowMissingContext7
        ) {
          throw new Error(`Context7 unavailable during full profile: ${record.error}`);
        }

        records.push(record);
      }
    }
  }

  const rawPath = path.join(outDir, `${runId}.raw.jsonl`);
  const summaryPath = path.join(outDir, `${runId}.summary.json`);
  const reportPath = path.join(outDir, `${runId}.report.md`);

  const jsonl = records.map((entry) => JSON.stringify(entry)).join("\n");
  fs.writeFileSync(rawPath, `${jsonl}\n`, "utf8");

  const summary = buildSummary(records);
  const markdown = toMarkdown(summary, records);
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(reportPath, `${markdown}\n`, "utf8");

  process.stdout.write(
    `${JSON.stringify({ ok: true, run_id: runId, raw: rawPath, summary: summaryPath, report: reportPath }, null, 2)}\n`
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

import { spawnSync } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";

function runCliJson({ repoRoot, args, cwd }) {
  const cliPath = path.join(repoRoot, "src", "cli.mjs");
  const started = performance.now();
  const result = spawnSync("node", [cliPath, ...args], {
    cwd,
    encoding: "utf8"
  });
  const ended = performance.now();

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

  return {
    status,
    stdout,
    stderr,
    payload,
    duration_ms: Number((ended - started).toFixed(2))
  };
}

function blocksFromUsePayload(payload) {
  const blocks = [];
  for (const step of payload?.steps || []) {
    const lines = [];
    if (step?.instruction) {
      lines.push(String(step.instruction));
    }
    if (step?.command) {
      lines.push(`Command: ${step.command}`);
    }
    if (step?.prerequisites) {
      lines.push(`Prerequisites: ${step.prerequisites}`);
    }
    if (step?.expected) {
      lines.push(`Expected: ${step.expected}`);
    }

    blocks.push({
      text: lines.join("\n").trim(),
      citation: Array.isArray(step?.citations) && step.citations.length > 0 ? step.citations[0] : ""
    });
  }

  if (payload?.snippet) {
    blocks.push({
      text: `Snippet:\n${payload.snippet}`,
      citation: (payload?.citations || [""])[0] || ""
    });
  }

  return blocks.filter((entry) => entry.text);
}

export function retrieveWithTrailDocs({ benchCase, corpus, limits, repoRoot }) {
  const maxBlocks = Number.isFinite(limits?.max_blocks) ? limits.max_blocks : 8;
  const contextBlocks = [];
  let commandCount = 0;
  let rawBytes = 0;
  let elapsed = 0;

  const useResult = runCliJson({
    repoRoot,
    cwd: repoRoot,
    args: [
      "use",
      corpus.library,
      benchCase.question,
      "--path",
      corpus.manifest_dir,
      "--max-results",
      String(maxBlocks),
      "--json"
    ]
  });
  commandCount += 1;
  elapsed += useResult.duration_ms;
  rawBytes += useResult.stdout.length;

  if (useResult.status === 0 && useResult.payload && !useResult.payload.error) {
    contextBlocks.push(...blocksFromUsePayload(useResult.payload));
  }

  if (contextBlocks.length === 0) {
    const searchResult = runCliJson({
      repoRoot,
      cwd: repoRoot,
      args: [
        "search",
        benchCase.question,
        "--index",
        corpus.index_path,
        "--max-results",
        String(maxBlocks),
        "--json"
      ]
    });
    commandCount += 1;
    elapsed += searchResult.duration_ms;
    rawBytes += searchResult.stdout.length;

    if (searchResult.status === 0 && Array.isArray(searchResult.payload?.results)) {
      for (const entry of searchResult.payload.results.slice(0, maxBlocks)) {
        const ref = `${entry.doc_id}#${entry.anchor}`;
        const openResult = runCliJson({
          repoRoot,
          cwd: repoRoot,
          args: ["open", ref, "--index", corpus.index_path, "--max-chars", "900", "--json"]
        });
        commandCount += 1;
        elapsed += openResult.duration_ms;
        rawBytes += openResult.stdout.length;
        if (openResult.status === 0 && openResult.payload && !openResult.payload.error) {
          contextBlocks.push({
            text: openResult.payload.content || entry.snippet || "",
            citation: `${openResult.payload.doc_id}#${openResult.payload.anchor}`
          });
        }
      }
    }
  }

  if (contextBlocks.length === 0) {
    return {
      ok: false,
      context_blocks: [],
      retrieval_meta: {
        latency_ms: Number(elapsed.toFixed(2)),
        command_count: commandCount,
        raw_bytes: rawBytes
      },
      error: useResult.stderr || "trail-docs returned no context"
    };
  }

  return {
    ok: true,
    context_blocks: contextBlocks.slice(0, maxBlocks),
    retrieval_meta: {
      latency_ms: Number(elapsed.toFixed(2)),
      command_count: commandCount,
      raw_bytes: rawBytes
    }
  };
}

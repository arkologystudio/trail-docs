import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

function asBlocksFromArray(items) {
  const blocks = [];
  for (const item of items || []) {
    const text = String(
      item?.text || item?.content || item?.snippet || item?.codeSnippet || item?.description || ""
    ).trim();
    const citation = String(
      item?.citation || item?.source || item?.id || item?.filePath || item?.path || ""
    ).trim();
    if (!text) {
      continue;
    }
    blocks.push({ text, citation });
  }
  return blocks;
}

function asBlocksFromV2Context(payload) {
  const blocks = [];

  const codeSnippets = Array.isArray(payload?.codeSnippets) ? payload.codeSnippets : [];
  for (const entry of codeSnippets) {
    const code = String(entry?.codeSnippet || "").trim();
    const note = String(entry?.description || "").trim();
    const text = [note, code].filter(Boolean).join("\n").trim();
    if (!text) {
      continue;
    }

    const citation = String(entry?.source || entry?.filePath || entry?.url || "").trim();
    blocks.push({ text, citation });
  }

  const infoSnippets = Array.isArray(payload?.infoSnippets) ? payload.infoSnippets : [];
  for (const entry of infoSnippets) {
    const title = String(entry?.title || "").trim();
    const content = String(entry?.content || entry?.description || "").trim();
    const text = [title, content].filter(Boolean).join("\n").trim();
    if (!text) {
      continue;
    }
    const citation = String(entry?.source || entry?.url || title || "").trim();
    blocks.push({ text, citation });
  }

  return blocks;
}

function parsePlainContext7Text(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return [];
  }

  const sections = normalized
    .split(/\n-{20,}\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const blocks = [];
  for (const section of sections) {
    const lines = section.split("\n");
    const sourceLine = lines.find((line) => line.toLowerCase().startsWith("source:")) || "";
    const citation = sourceLine.replace(/^source:\s*/i, "").trim();
    const textBody = lines.filter((line) => !line.toLowerCase().startsWith("source:")).join("\n").trim();
    if (!textBody) {
      continue;
    }
    blocks.push({ text: textBody, citation });
  }

  return blocks;
}

export function normalizeContext7Payload(payload) {
  if (Array.isArray(payload)) {
    return asBlocksFromArray(payload);
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  if (Array.isArray(payload.context_blocks)) {
    return asBlocksFromArray(payload.context_blocks);
  }
  if (Array.isArray(payload.results)) {
    return asBlocksFromArray(payload.results);
  }
  if (Array.isArray(payload.chunks)) {
    return asBlocksFromArray(payload.chunks);
  }

  const v2Blocks = asBlocksFromV2Context(payload);
  if (v2Blocks.length > 0) {
    return v2Blocks;
  }

  return [];
}

function runContext7Command({ command, query, corpusPath, maxBlocks }) {
  const started = performance.now();
  let result = spawnSync("zsh", ["-lc", command], {
    encoding: "utf8",
    env: {
      ...process.env,
      CONTEXT7_QUERY: query,
      CONTEXT7_CORPUS_PATH: corpusPath,
      CONTEXT7_MAX_BLOCKS: String(maxBlocks)
    }
  });

  if (result.error && result.error.code === "ENOENT") {
    result = spawnSync("/bin/sh", ["-lc", command], {
      encoding: "utf8",
      env: {
        ...process.env,
        CONTEXT7_QUERY: query,
        CONTEXT7_CORPUS_PATH: corpusPath,
        CONTEXT7_MAX_BLOCKS: String(maxBlocks)
      }
    });
  }
  const ended = performance.now();

  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();

  if ((result.status ?? 1) !== 0) {
    return {
      ok: false,
      latency_ms: Number((ended - started).toFixed(2)),
      command_count: 1,
      raw_bytes: stdout.length,
      error: stderr || `Context7 command exited with status ${result.status}`,
      payload: null
    };
  }

  let payload = null;
  try {
    payload = JSON.parse(stdout || "{}");
  } catch {
    return {
      ok: false,
      latency_ms: Number((ended - started).toFixed(2)),
      command_count: 1,
      raw_bytes: stdout.length,
      error: "Context7 command output must be valid JSON",
      payload: null
    };
  }

  return {
    ok: true,
    latency_ms: Number((ended - started).toFixed(2)),
    command_count: 1,
    raw_bytes: stdout.length,
    payload
  };
}

function buildApiHeaders(apiKey = "") {
  const headers = {
    Accept: "application/json"
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["X-API-Key"] = apiKey;
    headers["x-api-key"] = apiKey;
  }

  return headers;
}

async function fetchRaw(url, headers) {
  const response = await fetch(url, { method: "GET", headers });
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  return {
    ok: response.ok,
    status: response.status,
    text,
    content_type: contentType,
    raw_bytes: text.length
  };
}

async function runContext7ApiV2({ apiUrl, apiKey, libraryName, query }) {
  const started = performance.now();
  const headers = buildApiHeaders(apiKey);
  const base = String(apiUrl || "").replace(/\/+$/, "");

  const searchParams = new URLSearchParams({
    query,
    libraryName: libraryName || ""
  });
  const searchUrl = `${base}/libs/search?${searchParams.toString()}`;
  const searchResult = await fetchRaw(searchUrl, headers);

  if (!searchResult.ok) {
    const ended = performance.now();
    return {
      ok: false,
      latency_ms: Number((ended - started).toFixed(2)),
      command_count: 1,
      raw_bytes: searchResult.raw_bytes,
      error: `Context7 API error (${searchResult.status}): ${searchResult.text}`,
      payload: null
    };
  }

  let searchPayload;
  try {
    searchPayload = JSON.parse(searchResult.text || "{}");
  } catch {
    const ended = performance.now();
    return {
      ok: false,
      latency_ms: Number((ended - started).toFixed(2)),
      command_count: 1,
      raw_bytes: searchResult.raw_bytes,
      error: "Context7 /libs/search returned non-JSON payload",
      payload: null
    };
  }

  const candidates = Array.isArray(searchPayload?.results) ? searchPayload.results : [];
  const chosen = candidates[0];
  if (!chosen?.id) {
    const ended = performance.now();
    return {
      ok: false,
      latency_ms: Number((ended - started).toFixed(2)),
      command_count: 1,
      raw_bytes: searchResult.raw_bytes,
      error: "Context7 API returned no library matches",
      payload: null
    };
  }

  const contextParams = new URLSearchParams({
    libraryId: chosen.id,
    query
  });
  const contextUrl = `${base}/context?${contextParams.toString()}`;
  const contextResult = await fetchRaw(contextUrl, headers);
  const ended = performance.now();

  if (!contextResult.ok) {
    return {
      ok: false,
      latency_ms: Number((ended - started).toFixed(2)),
      command_count: 2,
      raw_bytes: searchResult.raw_bytes + contextResult.raw_bytes,
      error: `Context7 API error (${contextResult.status}): ${contextResult.text}`,
      payload: null
    };
  }

  let contextPayload;
  if (/application\/json/i.test(contextResult.content_type)) {
    try {
      contextPayload = JSON.parse(contextResult.text || "{}");
    } catch {
      return {
        ok: false,
        latency_ms: Number((ended - started).toFixed(2)),
        command_count: 2,
        raw_bytes: searchResult.raw_bytes + contextResult.raw_bytes,
        error: "Context7 /context returned invalid JSON payload",
        payload: null
      };
    }
  } else {
    contextPayload = {
      context_blocks: parsePlainContext7Text(contextResult.text)
    };
  }

  return {
    ok: true,
    latency_ms: Number((ended - started).toFixed(2)),
    command_count: 2,
    raw_bytes: searchResult.raw_bytes + contextResult.raw_bytes,
    payload: contextPayload
  };
}

async function runContext7ApiLegacy({ apiUrl, apiKey, query, corpusPath, maxBlocks }) {
  const started = performance.now();
  const headers = {
    ...buildApiHeaders(apiKey),
    "Content-Type": "application/json"
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query,
      corpus_path: corpusPath,
      max_blocks: maxBlocks
    })
  });

  const payloadText = await response.text();
  const ended = performance.now();

  if (!response.ok) {
    return {
      ok: false,
      latency_ms: Number((ended - started).toFixed(2)),
      command_count: 1,
      raw_bytes: payloadText.length,
      error: `Context7 API error (${response.status}): ${payloadText}`,
      payload: null
    };
  }

  let payload = null;
  try {
    payload = JSON.parse(payloadText || "{}");
  } catch {
    return {
      ok: false,
      latency_ms: Number((ended - started).toFixed(2)),
      command_count: 1,
      raw_bytes: payloadText.length,
      error: "Context7 API returned non-JSON payload",
      payload: null
    };
  }

  return {
    ok: true,
    latency_ms: Number((ended - started).toFixed(2)),
    command_count: 1,
    raw_bytes: payloadText.length,
    payload
  };
}

async function runContext7Api({ apiUrl, apiKey, query, corpusPath, maxBlocks, libraryName }) {
  const normalized = String(apiUrl || "").replace(/\/+$/, "");
  if (normalized.endsWith("/api/v2")) {
    return runContext7ApiV2({ apiUrl: normalized, apiKey, libraryName, query });
  }
  return runContext7ApiLegacy({ apiUrl, apiKey, query, corpusPath, maxBlocks });
}

export async function retrieveWithContext7({ benchCase, corpus, limits }) {
  const maxBlocks = Number.isFinite(limits?.max_blocks) ? limits.max_blocks : 8;
  const mode = String(process.env.CONTEXT7_MODE || "cmd").toLowerCase();

  let response;
  if (mode === "api") {
    const apiUrl = process.env.CONTEXT7_API_URL || "";
    if (!apiUrl) {
      return {
        ok: false,
        skipped: true,
        context_blocks: [],
        retrieval_meta: { latency_ms: 0, command_count: 0, raw_bytes: 0 },
        error: "CONTEXT7_API_URL is required when CONTEXT7_MODE=api"
      };
    }
    response = await runContext7Api({
      apiUrl,
      apiKey: process.env.CONTEXT7_API_KEY || "",
      query: benchCase.question,
      corpusPath: corpus.docs_dir,
      maxBlocks,
      libraryName: corpus.library
    });
  } else {
    const command = process.env.CONTEXT7_CMD || "";
    if (!command) {
      return {
        ok: false,
        skipped: true,
        context_blocks: [],
        retrieval_meta: { latency_ms: 0, command_count: 0, raw_bytes: 0 },
        error: "CONTEXT7_CMD is required when CONTEXT7_MODE=cmd"
      };
    }
    response = runContext7Command({
      command,
      query: benchCase.question,
      corpusPath: corpus.docs_dir,
      maxBlocks
    });
  }

  if (!response.ok) {
    return {
      ok: false,
      skipped: true,
      context_blocks: [],
      retrieval_meta: {
        latency_ms: response.latency_ms,
        command_count: response.command_count,
        raw_bytes: response.raw_bytes
      },
      error: response.error
    };
  }

  const blocks = normalizeContext7Payload(response.payload).slice(0, maxBlocks);
  if (blocks.length === 0) {
    return {
      ok: false,
      skipped: true,
      context_blocks: [],
      retrieval_meta: {
        latency_ms: response.latency_ms,
        command_count: response.command_count,
        raw_bytes: response.raw_bytes
      },
      error: "Context7 returned no context blocks"
    };
  }

  return {
    ok: true,
    context_blocks: blocks,
    retrieval_meta: {
      latency_ms: response.latency_ms,
      command_count: response.command_count,
      raw_bytes: response.raw_bytes
    }
  };
}

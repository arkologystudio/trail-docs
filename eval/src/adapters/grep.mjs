import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

function buildPattern(question) {
  const tokens = (String(question || "").toLowerCase().match(/[a-z0-9_]{3,}/g) || [])
    .filter((entry) => !["what", "when", "where", "which", "does", "with", "from", "that", "this"].includes(entry));
  const unique = [...new Set(tokens)].slice(0, 8);
  if (unique.length === 0) {
    return ".";
  }
  return unique.join("|");
}

function parseRipgrepLines(stdout) {
  const lines = String(stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = [];
  for (const line of lines) {
    const match = line.match(/^(.*?):(\d+):(.*)$/);
    if (!match) {
      continue;
    }
    parsed.push({
      file: match[1],
      line: Number(match[2]),
      excerpt: match[3].trim()
    });
  }
  return parsed;
}

function runSearch({ cwd, pattern }) {
  const rgResult = spawnSync(
    "rg",
    ["-n", "-i", "--no-heading", "--max-count", "60", "-e", pattern, "."],
    {
      cwd,
      encoding: "utf8"
    }
  );

  if (!rgResult.error && (rgResult.status === 0 || rgResult.status === 1)) {
    return rgResult;
  }

  const grepResult = spawnSync(
    "grep",
    ["-R", "-n", "-i", "-E", pattern, "."],
    {
      cwd,
      encoding: "utf8"
    }
  );

  return grepResult;
}

function findFirstDocFileRecursive(rootDir) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name)) {
        return fullPath;
      }
    }
  }
  return "";
}

function snippetForHit(rootDir, hit, windowLines = 5) {
  const absolute = path.resolve(rootDir, hit.file);
  if (!fs.existsSync(absolute)) {
    return null;
  }

  const all = fs.readFileSync(absolute, "utf8").split("\n");
  const start = Math.max(1, hit.line - windowLines);
  const end = Math.min(all.length, hit.line + windowLines);
  const selected = all.slice(start - 1, end).join("\n").trim();
  const relative = path.relative(rootDir, absolute).split(path.sep).join("/");

  return {
    text: selected,
    citation: `${relative}:${start}-${end}`
  };
}

export function retrieveWithGrep({ benchCase, corpus, limits }) {
  const maxBlocks = Number.isFinite(limits?.max_blocks) ? limits.max_blocks : 8;
  const windowLines = Number.isFinite(limits?.grep_window_lines) ? limits.grep_window_lines : 5;
  const pattern = buildPattern(benchCase.question);

  const started = performance.now();
  const rgResult = runSearch({ cwd: corpus.docs_dir, pattern });
  const ended = performance.now();

  const stdout = String(rgResult.stdout || "");
  const stderr = String(rgResult.stderr || "");
  const hits = parseRipgrepLines(stdout);

  const blocks = [];
  const seen = new Set();
  for (const hit of hits) {
    if (blocks.length >= maxBlocks) {
      break;
    }
    const key = `${hit.file}:${hit.line}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const snippet = snippetForHit(corpus.docs_dir, hit, windowLines);
    if (snippet?.text) {
      blocks.push(snippet);
    }
  }

  if (blocks.length === 0) {
    const firstDoc = findFirstDocFileRecursive(corpus.docs_dir);
    if (firstDoc) {
      const content = fs.readFileSync(firstDoc, "utf8").split("\n").slice(0, 12).join("\n");
      const relative = path.relative(corpus.docs_dir, firstDoc).split(path.sep).join("/");
      blocks.push({ text: content, citation: relative });
    }
  }

  if (blocks.length === 0) {
    return {
      ok: false,
      context_blocks: [],
      retrieval_meta: {
        latency_ms: Number((ended - started).toFixed(2)),
        command_count: 1,
        raw_bytes: stdout.length
      },
      error: stderr || "grep returned no usable context"
    };
  }

  return {
    ok: true,
    context_blocks: blocks,
    retrieval_meta: {
      latency_ms: Number((ended - started).toFixed(2)),
      command_count: 1,
      raw_bytes: stdout.length
    }
  };
}

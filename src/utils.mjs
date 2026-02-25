import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  const booleanFlags = new Set(["json", "no-color", "help", "emit-manifest"]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const flagName = token.slice(2);
    if (booleanFlags.has(flagName)) {
      flags[flagName] = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    flags[flagName] = next;
    index += 1;
  }

  return { flags, positionals };
}

export function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

export function walkMarkdownFiles(rootDir) {
  const output = [];
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

      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        output.push(fullPath);
      }
    }
  }

  output.sort((left, right) => left.localeCompare(right));
  return output;
}

export function normalizeAnchor(rawText) {
  const lower = rawText.trim().toLowerCase();
  const cleaned = lower.replace(/[^a-z0-9\s-]/g, "");
  const dashed = cleaned.replace(/\s+/g, "-").replace(/-+/g, "-");
  return dashed.replace(/^-+|-+$/g, "") || "section";
}

export function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function truncate(value, maxChars) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function parseDocRef(rawRef) {
  const [docId, anchor = ""] = rawRef.split("#");
  return { docId, anchor };
}

export function tokenize(value) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 1);
}

export function countOccurrences(text, token) {
  if (!token) {
    return 0;
  }

  let index = 0;
  let total = 0;
  while (index >= 0) {
    index = text.indexOf(token, index);
    if (index >= 0) {
      total += 1;
      index += token.length;
    }
  }
  return total;
}

export function stableUnique(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

export function projectRelativePath(absolutePath) {
  return toPosixPath(path.relative(process.cwd(), absolutePath));
}

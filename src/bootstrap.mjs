import fs from "node:fs";
import path from "node:path";
import { CliError } from "./errors.mjs";
import { EXIT_CODES } from "./constants.mjs";
import { ensureDirForFile, projectRelativePath, walkMarkdownFiles } from "./utils.mjs";

const CODE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".py",
  ".go",
  ".rs"
]);

function walkCodeFiles(rootDir) {
  const output = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".doccli") {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (CODE_EXTENSIONS.has(extension)) {
        output.push(fullPath);
      }
    }
  }

  output.sort((left, right) => left.localeCompare(right));
  return output;
}

function lineNumberFromIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function extractWithRegex(content, regex, mapper) {
  const output = [];
  let match = regex.exec(content);
  while (match) {
    output.push(mapper(match));
    match = regex.exec(content);
  }
  return output;
}

function extractSymbols(extension, content) {
  const symbols = [];

  if ([".js", ".mjs", ".cjs", ".ts", ".tsx"].includes(extension)) {
    symbols.push(
      ...extractWithRegex(
        content,
        /export\s+(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g,
        (match) => ({
          kind: "function",
          name: match[1],
          signature: `${match[1]}(${match[2].trim()})`,
          line: lineNumberFromIndex(content, match.index)
        })
      )
    );
    symbols.push(
      ...extractWithRegex(content, /export\s+class\s+([A-Za-z_]\w*)/g, (match) => ({
        kind: "class",
        name: match[1],
        signature: `${match[1]}`,
        line: lineNumberFromIndex(content, match.index)
      }))
    );
  }

  if (extension === ".py") {
    symbols.push(
      ...extractWithRegex(content, /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\):/gm, (match) => ({
        kind: "function",
        name: match[1],
        signature: `${match[1]}(${match[2].trim()})`,
        line: lineNumberFromIndex(content, match.index)
      }))
    );
    symbols.push(
      ...extractWithRegex(content, /^class\s+([A-Za-z_]\w*)\s*[:(]/gm, (match) => ({
        kind: "class",
        name: match[1],
        signature: `${match[1]}`,
        line: lineNumberFromIndex(content, match.index)
      }))
    );
  }

  if (extension === ".go") {
    symbols.push(
      ...extractWithRegex(
        content,
        /^func\s+(?:\([^)]+\)\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)/gm,
        (match) => ({
          kind: "function",
          name: match[1],
          signature: `${match[1]}(${match[2].trim()})`,
          line: lineNumberFromIndex(content, match.index)
        })
      )
    );
  }

  if (extension === ".rs") {
    symbols.push(
      ...extractWithRegex(content, /pub\s+fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g, (match) => ({
        kind: "function",
        name: match[1],
        signature: `${match[1]}(${match[2].trim()})`,
        line: lineNumberFromIndex(content, match.index)
      }))
    );
  }

  return symbols;
}

function extractEnvVars(content) {
  const regexes = [
    /\bprocess\.env\.([A-Z][A-Z0-9_]{1,})\b/g,
    /\bos\.getenv\(\s*["']([A-Z][A-Z0-9_]{1,})["']\s*\)/g,
    /\bstd::env::var\(\s*["']([A-Z][A-Z0-9_]{1,})["']\s*\)/g,
    /\bgetenv\(\s*["']([A-Z][A-Z0-9_]{1,})["']\s*\)/g
  ];
  const found = new Set();
  for (const regex of regexes) {
    let match = regex.exec(content);
    while (match) {
      found.add(match[1]);
      match = regex.exec(content);
    }
  }
  return Array.from(found).sort((left, right) => left.localeCompare(right));
}

function extractRoutes(content) {
  const routes = [];
  const expressRegex = /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
  let match = expressRegex.exec(content);
  while (match) {
    routes.push(`${match[1].toUpperCase()} ${match[2]}`);
    match = expressRegex.exec(content);
  }

  const fastApiRegex = /@app\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
  match = fastApiRegex.exec(content);
  while (match) {
    routes.push(`${match[1].toUpperCase()} ${match[2]}`);
    match = fastApiRegex.exec(content);
  }

  return Array.from(new Set(routes)).sort((left, right) => left.localeCompare(right));
}

function buildMarkdown(library, codeFiles, extracted) {
  const lines = [];
  lines.push(`# ${library} Bootstrap Docs`);
  lines.push("");
  lines.push("This documentation is generated from source code.");
  lines.push("Confidence: partial (derived/inferred).");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Source files scanned: ${codeFiles.length}`);
  lines.push(`- Symbols detected: ${extracted.totalSymbols}`);
  lines.push(`- Routes detected: ${extracted.totalRoutes}`);
  lines.push(`- Environment vars detected: ${extracted.totalEnvVars}`);
  lines.push("");

  if (extracted.totalEnvVars > 0) {
    lines.push("## Environment Variables");
    lines.push("");
    for (const envVar of extracted.envVars) {
      lines.push(`- \`${envVar}\``);
    }
    lines.push("");
  }

  if (extracted.totalRoutes > 0) {
    lines.push("## Routes");
    lines.push("");
    for (const route of extracted.routes) {
      lines.push(`- ${route}`);
    }
    lines.push("");
  }

  lines.push("## Symbols");
  lines.push("");

  for (const fileResult of extracted.files) {
    if (
      fileResult.symbols.length === 0 &&
      fileResult.routes.length === 0 &&
      fileResult.envVars.length === 0
    ) {
      continue;
    }
    lines.push(`### ${fileResult.sourcePath}`);
    lines.push("");
    if (fileResult.symbols.length > 0) {
      lines.push("Functions and classes:");
      lines.push("");
      for (const symbol of fileResult.symbols) {
        lines.push(`- ${symbol.kind}: \`${symbol.signature}\` (line ${symbol.line})`);
      }
      lines.push("");
    }
    if (fileResult.routes.length > 0) {
      lines.push("Routes:");
      lines.push("");
      for (const route of fileResult.routes) {
        lines.push(`- ${route}`);
      }
      lines.push("");
    }
    if (fileResult.envVars.length > 0) {
      lines.push("Environment variables:");
      lines.push("");
      for (const envVar of fileResult.envVars) {
        lines.push(`- \`${envVar}\``);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

export function generateBootstrapDocs({ srcDir, docsOutDir, library }) {
  if (!fs.existsSync(srcDir)) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `Source directory does not exist: ${srcDir}`,
      "Pass an existing directory to --src"
    );
  }

  const absoluteSrc = path.resolve(srcDir);
  const codeFiles = walkCodeFiles(absoluteSrc);
  const existingMarkdown = walkMarkdownFiles(absoluteSrc);
  if (codeFiles.length === 0 && existingMarkdown.length === 0) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `No code or markdown files found in ${srcDir}`,
      "Point --src at a repository root"
    );
  }

  const extracted = {
    files: [],
    envVars: new Set(),
    routes: new Set(),
    totalSymbols: 0,
    totalRoutes: 0,
    totalEnvVars: 0
  };

  for (const filePath of codeFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    const extension = path.extname(filePath).toLowerCase();
    const symbols = extractSymbols(extension, content);
    const envVars = extractEnvVars(content);
    const routes = extractRoutes(content);
    extracted.totalSymbols += symbols.length;
    extracted.totalRoutes += routes.length;
    extracted.totalEnvVars += envVars.length;
    for (const envVar of envVars) {
      extracted.envVars.add(envVar);
    }
    for (const route of routes) {
      extracted.routes.add(route);
    }
    extracted.files.push({
      sourcePath: projectRelativePath(filePath),
      symbols,
      envVars,
      routes
    });
  }

  extracted.files.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

  const markdown = buildMarkdown(library, codeFiles, {
    files: extracted.files,
    envVars: Array.from(extracted.envVars).sort((left, right) => left.localeCompare(right)),
    routes: Array.from(extracted.routes).sort((left, right) => left.localeCompare(right)),
    totalSymbols: extracted.totalSymbols,
    totalRoutes: extracted.totalRoutes,
    totalEnvVars: extracted.totalEnvVars
  });

  const docsFile = path.resolve(docsOutDir, "bootstrap.md");
  ensureDirForFile(docsFile);
  fs.writeFileSync(docsFile, markdown, "utf8");

  return {
    docs_dir: path.resolve(docsOutDir),
    docs_file: docsFile,
    source_files_scanned: codeFiles.length,
    symbols_detected: extracted.totalSymbols,
    routes_detected: extracted.totalRoutes,
    env_vars_detected: extracted.totalEnvVars
  };
}

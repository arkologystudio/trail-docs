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

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".trail-docs",
  "dist",
  "build",
  "coverage",
  "vendor",
  ".next",
  "out",
  "target",
  "venv",
  ".venv",
  "__pycache__"
]);

const IMPLICIT_DOC_FILES = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "makefile",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "procfile"
]);

function isIgnoredDirectory(name) {
  return IGNORED_DIRECTORIES.has(name.toLowerCase());
}

function isMinifiedFile(name) {
  return /\.min\.(js|mjs|cjs|css)$/i.test(name);
}

function isWorkflowFile(filePath) {
  const normalized = filePath.split(path.sep).join("/").toLowerCase();
  return normalized.includes("/.github/workflows/") && /\.(yml|yaml)$/.test(normalized);
}

function walkSourceFiles(rootDir) {
  const codeFiles = [];
  const implicitFiles = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isDirectory() && isIgnoredDirectory(entry.name)) {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || isMinifiedFile(entry.name)) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (CODE_EXTENSIONS.has(extension)) {
        codeFiles.push(fullPath);
      }

      const lowered = entry.name.toLowerCase();
      if (IMPLICIT_DOC_FILES.has(lowered) || isWorkflowFile(fullPath)) {
        implicitFiles.push(fullPath);
      }
    }
  }

  codeFiles.sort((left, right) => left.localeCompare(right));
  implicitFiles.sort((left, right) => left.localeCompare(right));
  return { codeFiles, implicitFiles };
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

function stableUniqueBy(items, keyBuilder) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyBuilder(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
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
  const patterns = [
    /\bprocess\.env\.([A-Z][A-Z0-9_]{1,})\b/g,
    /\bprocess\.env\[\s*["']([A-Z][A-Z0-9_]{1,})["']\s*\]/g,
    /\bimport\.meta\.env\.([A-Z][A-Z0-9_]{1,})\b/g,
    /\bos\.getenv\(\s*["']([A-Z][A-Z0-9_]{1,})["']\s*\)/g,
    /\bstd::env::var\(\s*["']([A-Z][A-Z0-9_]{1,})["']\s*\)/g,
    /\bgetenv\(\s*["']([A-Z][A-Z0-9_]{1,})["']\s*\)/g,
    /\bDeno\.env\.get\(\s*["']([A-Z][A-Z0-9_]{1,})["']\s*\)/g,
    /\bos\.Getenv\(\s*"([A-Z][A-Z0-9_]{1,})"\s*\)/g
  ];

  const matches = [];
  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      matches.push({
        name: match[1],
        line: lineNumberFromIndex(content, match.index)
      });
      match = pattern.exec(content);
    }
  }

  return stableUniqueBy(matches, (entry) => `${entry.name}:${entry.line}`).sort((left, right) => {
    if (left.name !== right.name) {
      return left.name.localeCompare(right.name);
    }
    return left.line - right.line;
  });
}

function extractRoutes(content) {
  const routes = [];

  const addRoute = (method, routePath, index) => {
    if (!method || !routePath) {
      return;
    }
    routes.push({
      route: `${String(method).toUpperCase()} ${routePath}`,
      line: lineNumberFromIndex(content, index)
    });
  };

  const expressRegex = /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
  let match = expressRegex.exec(content);
  while (match) {
    addRoute(match[1], match[2], match.index);
    match = expressRegex.exec(content);
  }

  const fastApiRegex = /@(?:app|router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
  match = fastApiRegex.exec(content);
  while (match) {
    addRoute(match[1], match[2], match.index);
    match = fastApiRegex.exec(content);
  }

  const flaskRouteRegex = /@(?:app|bp|blueprint)\.route\(\s*["'`]([^"'`]+)["'`](?:\s*,\s*methods\s*=\s*\[([^\]]+)\])?/g;
  match = flaskRouteRegex.exec(content);
  while (match) {
    if (match[2]) {
      const methods = Array.from(match[2].matchAll(/["'`]([A-Za-z]+)["'`]/g)).map((item) => item[1]);
      if (methods.length > 0) {
        for (const method of methods) {
          addRoute(method, match[1], match.index);
        }
      } else {
        addRoute("GET", match[1], match.index);
      }
    } else {
      addRoute("GET", match[1], match.index);
    }
    match = flaskRouteRegex.exec(content);
  }

  const ginRegex = /\.(GET|POST|PUT|PATCH|DELETE)\(\s*"([^"]+)"/g;
  match = ginRegex.exec(content);
  while (match) {
    addRoute(match[1], match[2], match.index);
    match = ginRegex.exec(content);
  }

  return stableUniqueBy(routes, (entry) => `${entry.route}:${entry.line}`).sort((left, right) => {
    if (left.route !== right.route) {
      return left.route.localeCompare(right.route);
    }
    return left.line - right.line;
  });
}

function extractImplicitSignals(filePath, content) {
  const signals = [];
  const fileName = path.basename(filePath).toLowerCase();

  if (fileName === "package.json") {
    try {
      const parsed = JSON.parse(content);
      const scripts = parsed && typeof parsed.scripts === "object" ? Object.keys(parsed.scripts) : [];
      const dependencies = parsed && typeof parsed.dependencies === "object" ? Object.keys(parsed.dependencies) : [];

      for (const script of scripts.sort((left, right) => left.localeCompare(right))) {
        signals.push({ kind: "script", value: `npm run ${script}`, line: 1 });
      }
      for (const dependency of dependencies.sort((left, right) => left.localeCompare(right)).slice(0, 12)) {
        signals.push({ kind: "dependency", value: dependency, line: 1 });
      }
    } catch {
      return [];
    }
  }

  if (fileName === "makefile") {
    const targetRegex = /^([A-Za-z0-9_.-]+)\s*:/gm;
    let match = targetRegex.exec(content);
    while (match) {
      if (!match[1].startsWith(".")) {
        signals.push({
          kind: "make-target",
          value: match[1],
          line: lineNumberFromIndex(content, match.index)
        });
      }
      match = targetRegex.exec(content);
    }
  }

  if (fileName === "dockerfile") {
    const patterns = ["FROM", "EXPOSE", "CMD", "ENTRYPOINT", "HEALTHCHECK"];
    for (const directive of patterns) {
      const regex = new RegExp(`^${directive}\\s+(.+)$`, "gim");
      let match = regex.exec(content);
      while (match) {
        signals.push({
          kind: "docker",
          value: `${directive} ${match[1].trim()}`,
          line: lineNumberFromIndex(content, match.index)
        });
        match = regex.exec(content);
      }
    }
  }

  if (fileName === "requirements.txt") {
    const requirementsRegex = /^\s*([A-Za-z0-9_.-]+)(?:[<>=!~]=.+)?\s*$/gm;
    let match = requirementsRegex.exec(content);
    while (match) {
      if (match[1]) {
        signals.push({
          kind: "dependency",
          value: match[1],
          line: lineNumberFromIndex(content, match.index)
        });
      }
      match = requirementsRegex.exec(content);
    }
  }

  if (fileName === "pyproject.toml") {
    const nameRegex = /^\s*name\s*=\s*["']([^"']+)["']\s*$/gm;
    const runtimeRegex = /^\s*requires-python\s*=\s*["']([^"']+)["']\s*$/gm;
    let match = nameRegex.exec(content);
    while (match) {
      signals.push({
        kind: "project",
        value: match[1],
        line: lineNumberFromIndex(content, match.index)
      });
      match = nameRegex.exec(content);
    }

    match = runtimeRegex.exec(content);
    while (match) {
      signals.push({
        kind: "runtime",
        value: `python ${match[1]}`,
        line: lineNumberFromIndex(content, match.index)
      });
      match = runtimeRegex.exec(content);
    }
  }

  if (isWorkflowFile(filePath)) {
    const runRegex = /^\s*-\s*run:\s*(.+)$/gm;
    let match = runRegex.exec(content);
    while (match) {
      signals.push({
        kind: "ci-run",
        value: match[1].trim(),
        line: lineNumberFromIndex(content, match.index)
      });
      match = runRegex.exec(content);
    }
  }

  return stableUniqueBy(signals, (entry) => `${entry.kind}:${entry.value}:${entry.line}`);
}

function addLocation(indexMap, key, sourcePath, line) {
  if (!indexMap.has(key)) {
    indexMap.set(key, []);
  }
  indexMap.get(key).push({ sourcePath, line });
}

function formatLocations(locations, maxEntries = 3) {
  const unique = stableUniqueBy(locations, (entry) => `${entry.sourcePath}:${entry.line}`)
    .sort((left, right) => {
      if (left.sourcePath !== right.sourcePath) {
        return left.sourcePath.localeCompare(right.sourcePath);
      }
      return left.line - right.line;
    });
  const shown = unique.slice(0, maxEntries).map((entry) => `${entry.sourcePath}:${entry.line}`);
  const remainder = unique.length - shown.length;
  if (remainder > 0) {
    shown.push(`+${remainder} more`);
  }
  return shown.join(", ");
}

function buildMarkdown(library, scannedFilesCount, extracted) {
  const lines = [];
  lines.push(`# ${library} Bootstrap Docs`);
  lines.push("");
  lines.push("This documentation is generated from source code and runtime/tooling artifacts.");
  lines.push("Confidence: partial (derived/inferred).");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Source files scanned: ${scannedFilesCount}`);
  lines.push(`- Symbols detected: ${extracted.totalSymbols}`);
  lines.push(`- Routes detected: ${extracted.totalRoutes}`);
  lines.push(`- Environment vars detected: ${extracted.totalEnvVars}`);
  lines.push(`- Runtime/tooling signals detected: ${extracted.totalSignals}`);
  lines.push("");

  if (extracted.envVars.size > 0) {
    lines.push("## Environment Variables");
    lines.push("");
    const names = Array.from(extracted.envVars.keys()).sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      lines.push(`- \`${name}\` (${formatLocations(extracted.envVars.get(name))})`);
    }
    lines.push("");
  }

  if (extracted.routes.size > 0) {
    lines.push("## Routes");
    lines.push("");
    const routeList = Array.from(extracted.routes.keys()).sort((left, right) => left.localeCompare(right));
    for (const route of routeList) {
      lines.push(`- ${route} (${formatLocations(extracted.routes.get(route))})`);
    }
    lines.push("");
  }

  if (extracted.signals.size > 0) {
    lines.push("## Runtime and Tooling Signals");
    lines.push("");
    const signalList = Array.from(extracted.signals.keys()).sort((left, right) => left.localeCompare(right));
    for (const signal of signalList) {
      lines.push(`- ${signal} (${formatLocations(extracted.signals.get(signal))})`);
    }
    lines.push("");
  }

  lines.push("## Symbols");
  lines.push("");

  for (const fileResult of extracted.files) {
    if (
      fileResult.symbols.length === 0 &&
      fileResult.routes.length === 0 &&
      fileResult.envVars.length === 0 &&
      fileResult.signals.length === 0
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
        lines.push(`- ${route.route} (line ${route.line})`);
      }
      lines.push("");
    }

    if (fileResult.envVars.length > 0) {
      lines.push("Environment variables:");
      lines.push("");
      for (const envVar of fileResult.envVars) {
        lines.push(`- \`${envVar.name}\` (line ${envVar.line})`);
      }
      lines.push("");
    }

    if (fileResult.signals.length > 0) {
      lines.push("Operational signals:");
      lines.push("");
      for (const signal of fileResult.signals) {
        lines.push(`- ${signal.kind}: \`${signal.value}\` (line ${signal.line})`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
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
  const { codeFiles, implicitFiles } = walkSourceFiles(absoluteSrc);
  const existingMarkdown = walkMarkdownFiles(absoluteSrc);
  if (codeFiles.length === 0 && implicitFiles.length === 0 && existingMarkdown.length === 0) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `No code or markdown files found in ${srcDir}`,
      "Point --src at a repository root"
    );
  }

  const extracted = {
    files: [],
    envVars: new Map(),
    routes: new Map(),
    signals: new Map(),
    totalSymbols: 0,
    totalRoutes: 0,
    totalEnvVars: 0,
    totalSignals: 0
  };

  for (const filePath of codeFiles) {
    const content = readTextFile(filePath);
    if (!content) {
      continue;
    }

    const extension = path.extname(filePath).toLowerCase();
    const sourcePath = projectRelativePath(filePath);
    const symbols = extractSymbols(extension, content);
    const envVars = extractEnvVars(content);
    const routes = extractRoutes(content);

    extracted.totalSymbols += symbols.length;
    extracted.totalRoutes += routes.length;
    extracted.totalEnvVars += envVars.length;

    for (const envVar of envVars) {
      addLocation(extracted.envVars, envVar.name, sourcePath, envVar.line);
    }
    for (const route of routes) {
      addLocation(extracted.routes, route.route, sourcePath, route.line);
    }

    extracted.files.push({
      sourcePath,
      symbols,
      envVars,
      routes,
      signals: []
    });
  }

  for (const filePath of implicitFiles) {
    const content = readTextFile(filePath);
    if (!content) {
      continue;
    }

    const sourcePath = projectRelativePath(filePath);
    const signals = extractImplicitSignals(filePath, content);
    if (signals.length === 0) {
      continue;
    }

    extracted.totalSignals += signals.length;
    for (const signal of signals) {
      addLocation(extracted.signals, `${signal.kind}: ${signal.value}`, sourcePath, signal.line);
    }

    const existingFile = extracted.files.find((entry) => entry.sourcePath === sourcePath);
    if (existingFile) {
      existingFile.signals = stableUniqueBy(existingFile.signals.concat(signals), (entry) =>
        `${entry.kind}:${entry.value}:${entry.line}`
      );
      continue;
    }

    extracted.files.push({
      sourcePath,
      symbols: [],
      envVars: [],
      routes: [],
      signals
    });
  }

  extracted.files.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

  const uniqueScannedFiles = new Set([...codeFiles, ...implicitFiles]);
  const markdown = buildMarkdown(library, uniqueScannedFiles.size, extracted);

  const docsFile = path.resolve(docsOutDir, "bootstrap.md");
  ensureDirForFile(docsFile);
  fs.writeFileSync(docsFile, markdown, "utf8");

  return {
    docs_dir: path.resolve(docsOutDir),
    docs_file: docsFile,
    source_files_scanned: uniqueScannedFiles.size,
    symbols_detected: extracted.totalSymbols,
    routes_detected: extracted.totalRoutes,
    env_vars_detected: extracted.totalEnvVars,
    signals_detected: extracted.totalSignals
  };
}

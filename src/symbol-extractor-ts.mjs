import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { resolvePackageEntryCandidates } from "./source-resolver.mjs";
import { toPosixPath } from "./utils.mjs";

const SOURCE_EXTENSIONS = new Set([".d.ts", ".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", ".trail-docs", "coverage", ".cache", "tmp", "temp"]);

function nodeHasModifier(node, kind) {
  return Array.isArray(node.modifiers) && node.modifiers.some((entry) => entry.kind === kind);
}

function isExportedNode(node) {
  return nodeHasModifier(node, ts.SyntaxKind.ExportKeyword) || nodeHasModifier(node, ts.SyntaxKind.DefaultKeyword);
}

function lineRangeFromNode(sourceFile, node) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    line_start: start.line + 1,
    line_end: end.line + 1
  };
}

function extractSummary(sourceFile, node) {
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.pos) || [];
  if (ranges.length === 0) {
    return "";
  }

  const comment = sourceFile.text.slice(ranges[ranges.length - 1].pos, ranges[ranges.length - 1].end);
  const lines = comment
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("@"));

  return lines[0] || "";
}

function signatureFromFunction(name, node, sourceFile) {
  const params = node.parameters.map((entry) => entry.getText(sourceFile)).join(", ");
  const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : "";
  return `${name}(${params})${returnType}`;
}

function signatureFromMethod(name, node, sourceFile) {
  const params = node.parameters.map((entry) => entry.getText(sourceFile)).join(", ");
  const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : "";
  return `${name}(${params})${returnType}`;
}

function signatureFromVariable(name, node, sourceFile) {
  if (!node.initializer) {
    return `${name}`;
  }

  if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
    const params = node.initializer.parameters.map((entry) => entry.getText(sourceFile)).join(", ");
    const returnType = node.initializer.type ? `: ${node.initializer.type.getText(sourceFile)}` : "";
    return `${name}(${params})${returnType}`;
  }

  return `${name}`;
}

function toSymbolId(library, fqName) {
  return `${library}::${fqName}`;
}

function pushUniqueSignature(target, signature) {
  const normalized = String(signature || "").trim();
  if (!normalized) {
    return;
  }
  if (!target.includes(normalized)) {
    target.push(normalized);
  }
}

function normalizeModulePath(rootDir, filePath) {
  return toPosixPath(path.relative(rootDir, filePath));
}

function shouldIncludeFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (SOURCE_EXTENSIONS.has(extension)) {
    return true;
  }
  if (filePath.toLowerCase().endsWith(".d.ts")) {
    return true;
  }
  return false;
}

function walkSourceFiles(rootDir) {
  const output = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) {
          continue;
        }
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !shouldIncludeFile(fullPath)) {
        continue;
      }

      output.push(fullPath);
    }
  }

  output.sort((left, right) => left.localeCompare(right));
  return output;
}

function resolveOrderedFiles(rootDir) {
  const allFiles = walkSourceFiles(rootDir);
  const preferredEntries = resolvePackageEntryCandidates(rootDir);
  const seen = new Set();
  const output = [];

  for (const preferred of preferredEntries) {
    if (!allFiles.includes(preferred)) {
      continue;
    }
    seen.add(preferred);
    output.push(preferred);
  }

  for (const filePath of allFiles) {
    if (seen.has(filePath)) {
      continue;
    }
    seen.add(filePath);
    output.push(filePath);
  }

  return output;
}

function fallbackExtract(content, modulePath, library, outputSymbols, outputExports) {
  const extracted = [];
  const exportRegex = /export\s+(?:declare\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
  let match = exportRegex.exec(content);
  while (match) {
    extracted.push({
      name: match[1],
      fq_name: match[1],
      kind: "function",
      signatures: [`${match[1]}(${match[2].trim()})`],
      summary: "",
      module_path: modulePath,
      line_start: content.slice(0, match.index).split(/\r?\n/).length,
      line_end: content.slice(0, match.index).split(/\r?\n/).length
    });
    match = exportRegex.exec(content);
  }

  const classRegex = /export\s+(?:declare\s+)?class\s+([A-Za-z_]\w*)/g;
  match = classRegex.exec(content);
  while (match) {
    extracted.push({
      name: match[1],
      fq_name: match[1],
      kind: "class",
      signatures: [`class ${match[1]}`],
      summary: "",
      module_path: modulePath,
      line_start: content.slice(0, match.index).split(/\r?\n/).length,
      line_end: content.slice(0, match.index).split(/\r?\n/).length
    });
    match = classRegex.exec(content);
  }

  for (const symbol of extracted) {
    const symbolId = toSymbolId(library, symbol.fq_name);
    if (!outputSymbols.has(symbolId)) {
      outputSymbols.set(symbolId, {
        symbol_id: symbolId,
        ...symbol,
        signatures: [...symbol.signatures]
      });
    }

    outputExports.push({
      export_name: symbol.name,
      kind: symbol.kind,
      symbol_id: symbolId
    });
  }

  return extracted.length > 0;
}

export function extractTypeScriptSurface({
  library,
  rootDir,
  maxFiles = 2000,
  maxBytes = 20 * 1024 * 1024
}) {
  const orderedFiles = resolveOrderedFiles(rootDir);
  const symbolMap = new Map();
  const exportsList = [];
  let scanned = 0;
  let totalBytes = 0;
  let usedFallback = false;
  let hasTypedSignatures = false;

  for (const filePath of orderedFiles) {
    if (scanned >= maxFiles) {
      break;
    }

    const stat = fs.statSync(filePath);
    if (totalBytes + stat.size > maxBytes) {
      break;
    }

    scanned += 1;
    totalBytes += stat.size;

    const sourceText = fs.readFileSync(filePath, "utf8");
    const modulePath = normalizeModulePath(rootDir, filePath);
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
    const declarationsByName = new Map();
    let fileExtractedCount = 0;

    if (filePath.endsWith(".d.ts") || filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
      hasTypedSignatures = true;
    }

    const upsertSymbol = ({ name, fqName, kind, signature, node }) => {
      const symbolId = toSymbolId(library, fqName);
      const range = lineRangeFromNode(sourceFile, node);
      const summary = extractSummary(sourceFile, node);
      const existing = symbolMap.get(symbolId);
      if (existing) {
        pushUniqueSignature(existing.signatures, signature);
        return symbolId;
      }

      symbolMap.set(symbolId, {
        symbol_id: symbolId,
        name,
        fq_name: fqName,
        kind,
        signatures: signature ? [signature] : [],
        summary,
        module_path: modulePath,
        line_start: range.line_start,
        line_end: range.line_end
      });
      fileExtractedCount += 1;
      return symbolId;
    };

    const markDeclaration = (name, symbolId) => {
      if (!declarationsByName.has(name)) {
        declarationsByName.set(name, []);
      }
      declarationsByName.get(name).push(symbolId);
    };

    for (const statement of sourceFile.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name) {
        const name = statement.name.getText(sourceFile);
        const symbolId = upsertSymbol({
          name,
          fqName: name,
          kind: "function",
          signature: signatureFromFunction(name, statement, sourceFile),
          node: statement
        });
        markDeclaration(name, symbolId);

        if (isExportedNode(statement)) {
          exportsList.push({
            export_name: nodeHasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? "default" : name,
            kind: "function",
            symbol_id: symbolId
          });
        }
        continue;
      }

      if (ts.isClassDeclaration(statement) && statement.name) {
        const className = statement.name.getText(sourceFile);
        const classSymbolId = upsertSymbol({
          name: className,
          fqName: className,
          kind: "class",
          signature: `class ${className}`,
          node: statement
        });
        markDeclaration(className, classSymbolId);

        if (isExportedNode(statement)) {
          exportsList.push({
            export_name: nodeHasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? "default" : className,
            kind: "class",
            symbol_id: classSymbolId
          });

          for (const member of statement.members) {
            if (!ts.isMethodDeclaration(member) || !member.name) {
              continue;
            }

            const methodName = member.name.getText(sourceFile);
            const methodFqName = `${className}.${methodName}`;
            upsertSymbol({
              name: methodName,
              fqName: methodFqName,
              kind: "method",
              signature: signatureFromMethod(methodName, member, sourceFile),
              node: member
            });
          }
        }
        continue;
      }

      if (ts.isInterfaceDeclaration(statement)) {
        const interfaceName = statement.name.getText(sourceFile);
        const symbolId = upsertSymbol({
          name: interfaceName,
          fqName: interfaceName,
          kind: "type",
          signature: `interface ${interfaceName}`,
          node: statement
        });
        markDeclaration(interfaceName, symbolId);

        if (isExportedNode(statement)) {
          exportsList.push({
            export_name: interfaceName,
            kind: "type",
            symbol_id: symbolId
          });
        }
        continue;
      }

      if (ts.isTypeAliasDeclaration(statement)) {
        const aliasName = statement.name.getText(sourceFile);
        const symbolId = upsertSymbol({
          name: aliasName,
          fqName: aliasName,
          kind: "type",
          signature: `type ${aliasName} = ${statement.type.getText(sourceFile)}`,
          node: statement
        });
        markDeclaration(aliasName, symbolId);

        if (isExportedNode(statement)) {
          exportsList.push({
            export_name: aliasName,
            kind: "type",
            symbol_id: symbolId
          });
        }
        continue;
      }

      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) {
            continue;
          }

          const variableName = declaration.name.getText(sourceFile);
          const symbolId = upsertSymbol({
            name: variableName,
            fqName: variableName,
            kind: "function",
            signature: signatureFromVariable(variableName, declaration, sourceFile),
            node: declaration
          });
          markDeclaration(variableName, symbolId);

          if (isExportedNode(statement)) {
            exportsList.push({
              export_name: variableName,
              kind: "function",
              symbol_id: symbolId
            });
          }
        }
        continue;
      }

      if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const exportName = element.name.getText(sourceFile);
          const localName = element.propertyName ? element.propertyName.getText(sourceFile) : exportName;
          const localIds = declarationsByName.get(localName) || [];
          for (const symbolId of localIds) {
            const symbol = symbolMap.get(symbolId);
            if (!symbol) {
              continue;
            }
            exportsList.push({
              export_name: exportName,
              kind: symbol.kind,
              symbol_id: symbolId
            });
          }
        }
        continue;
      }

      if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
        const localName = statement.expression.getText(sourceFile);
        const localIds = declarationsByName.get(localName) || [];
        for (const symbolId of localIds) {
          const symbol = symbolMap.get(symbolId);
          if (!symbol) {
            continue;
          }
          exportsList.push({
            export_name: "default",
            kind: symbol.kind,
            symbol_id: symbolId
          });
        }
      }
    }

    const parseHasErrors = Array.isArray(sourceFile.parseDiagnostics) && sourceFile.parseDiagnostics.length > 0;
    if ((parseHasErrors || fileExtractedCount === 0) && fallbackExtract(sourceText, modulePath, library, symbolMap, exportsList)) {
      usedFallback = true;
    }
  }

  const dedupedExports = [];
  const exportSeen = new Set();
  for (const entry of exportsList) {
    const key = `${entry.export_name}:${entry.symbol_id}`;
    if (exportSeen.has(key)) {
      continue;
    }
    exportSeen.add(key);
    dedupedExports.push(entry);
  }

  dedupedExports.sort((left, right) => {
    if (left.export_name !== right.export_name) {
      return left.export_name.localeCompare(right.export_name);
    }
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    return left.symbol_id.localeCompare(right.symbol_id);
  });

  const symbols = Array.from(symbolMap.values()).sort((left, right) => {
    if (left.fq_name !== right.fq_name) {
      return left.fq_name.localeCompare(right.fq_name);
    }
    if (left.module_path !== right.module_path) {
      return left.module_path.localeCompare(right.module_path);
    }
    return left.line_start - right.line_start;
  });

  return {
    exports: dedupedExports,
    symbols,
    stats: {
      modules_scanned: scanned,
      symbols_extracted: symbols.length,
      bytes_scanned: totalBytes
    },
    confidence: hasTypedSignatures && !usedFallback ? "authoritative" : "partial"
  };
}

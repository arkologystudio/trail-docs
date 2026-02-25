import fs from "node:fs";
import path from "node:path";
import { CliError } from "./errors.mjs";
import { EXIT_CODES, TOOL_VERSION } from "./constants.mjs";
import { ensureDirForFile, hashText, projectRelativePath, walkMarkdownFiles } from "./utils.mjs";
import { parseMarkdownDocument } from "./markdown.mjs";

function validateIndex(index) {
  if (!index || typeof index !== "object") {
    return false;
  }
  if (!Array.isArray(index.docs) || !Array.isArray(index.sections)) {
    return false;
  }
  return typeof index.schema_version === "string";
}

export function buildIndex({ srcDir, outFile, library, version }) {
  if (!fs.existsSync(srcDir)) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `Source directory does not exist: ${srcDir}`,
      "Pass an existing directory to --src"
    );
  }

  const absoluteSrcDir = path.resolve(srcDir);
  const files = walkMarkdownFiles(absoluteSrcDir);
  if (files.length === 0) {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `No markdown files found in ${srcDir}`,
      "Add .md docs or point --src to the correct directory"
    );
  }

  const docs = [];
  const sections = [];
  const sourceHashes = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    const relativeToSrc = filePath.slice(absoluteSrcDir.length + 1).split(path.sep).join("/");
    const parsed = parseMarkdownDocument(relativeToSrc, content);
    const sourcePath = projectRelativePath(filePath);
    docs.push({
      doc_id: parsed.doc.doc_id,
      title: parsed.doc.title,
      source_path: sourcePath
    });

    for (const section of parsed.sections) {
      sections.push({
        ...section,
        source_path: sourcePath
      });
    }

    sourceHashes.push(`${relativeToSrc}:${hashText(content)}`);
  }

  docs.sort((left, right) => left.doc_id.localeCompare(right.doc_id));
  sections.sort((left, right) => {
    if (left.doc_id !== right.doc_id) {
      return left.doc_id.localeCompare(right.doc_id);
    }
    if (left.line_start !== right.line_start) {
      return left.line_start - right.line_start;
    }
    return left.anchor.localeCompare(right.anchor);
  });
  sourceHashes.sort((left, right) => left.localeCompare(right));

  const sourceHash = `sha256:${hashText(sourceHashes.join("\n"))}`;
  const index = {
    schema_version: "1",
    library,
    version,
    build: {
      tool_version: TOOL_VERSION,
      built_at: new Date().toISOString(),
      source_hash: sourceHash
    },
    docs,
    sections
  };

  ensureDirForFile(outFile);
  fs.writeFileSync(outFile, JSON.stringify(index, null, 2), "utf8");

  return {
    ok: true,
    library,
    version,
    index_path: outFile,
    docs_count: docs.length,
    sections_count: sections.length,
    source_hash: sourceHash
  };
}

export function loadIndex(indexPath) {
  try {
    const raw = fs.readFileSync(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!validateIndex(parsed)) {
      throw new CliError(
        EXIT_CODES.SCHEMA_MISMATCH,
        "SCHEMA_MISMATCH",
        `Invalid index schema in ${indexPath}`,
        "Re-run doccli build"
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(
      EXIT_CODES.INDEX_UNREADABLE,
      "INDEX_UNREADABLE",
      `Could not read index file: ${indexPath}`,
      "Run doccli build or verify index path"
    );
  }
}

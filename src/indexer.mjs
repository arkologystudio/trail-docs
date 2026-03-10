import fs from "node:fs";
import path from "node:path";
import { CliError } from "./errors.mjs";
import { EXIT_CODES, TOOL_VERSION } from "./constants.mjs";
import { ensureDirForFile, hashText, projectRelativePath, walkMarkdownFiles } from "./utils.mjs";
import { parseMarkdownDocument } from "./markdown.mjs";
import { buildAnchorGraph, extractEvidenceUnits } from "./evidence.mjs";

function validateIndex(index) {
  if (!index || typeof index !== "object") {
    return false;
  }
  if (
    !Array.isArray(index.docs) ||
    !Array.isArray(index.sections) ||
    !Array.isArray(index.evidence_units) ||
    !Array.isArray(index.anchor_graph)
  ) {
    return false;
  }
  return index.schema_version === "2";
}

function readSourceManifest(sourceManifestPath = "") {
  if (!sourceManifestPath) {
    return null;
  }

  try {
    const raw = fs.readFileSync(path.resolve(sourceManifestPath), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    throw new CliError(
      EXIT_CODES.INVALID_ARGS,
      "INVALID_ARGS",
      `Could not read source manifest: ${sourceManifestPath}`,
      "Pass a valid --source-manifest path or omit it"
    );
  }
}

export function buildIndex({ srcDir, outFile, library, version, sourceManifestPath = "", buildContext = null }) {
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
  const rawSections = [];
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
      rawSections.push({
        ...section,
        source_path: sourcePath
      });
      sections.push({
        section_id: section.section_id,
        doc_id: section.doc_id,
        anchor: section.anchor,
        heading: section.heading,
        line_start: section.line_start,
        line_end: section.line_end,
        text: section.text,
        snippet: section.snippet,
        code_blocks: section.code_blocks,
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

  const evidenceUnits = extractEvidenceUnits({
    library,
    version,
    sections: rawSections
  });
  const anchorGraph = buildAnchorGraph({
    sections: rawSections,
    evidenceUnits
  });

  const sourceHash = `sha256:${hashText(sourceHashes.join("\n"))}`;
  const sourceManifest = readSourceManifest(sourceManifestPath);
  const index = {
    schema_version: "2",
    library,
    version,
    build: {
      tool_version: TOOL_VERSION,
      built_at: new Date().toISOString(),
      source_hash: sourceHash
    },
    docs,
    sections,
    evidence_units: evidenceUnits,
    anchor_graph: anchorGraph
  };
  if (buildContext && typeof buildContext === "object") {
    const inferred = Boolean(buildContext.inferred);
    if (inferred) {
      index.build.inferred = true;
    }
    if (typeof buildContext.derivation === "string" && buildContext.derivation) {
      index.build.derivation = buildContext.derivation;
    }
  }
  if (sourceManifest) {
    index.build.source = {
      source_type: sourceManifest.source_type || "",
      provider: sourceManifest.provider || "",
      canonical_url: sourceManifest.canonical_url || "",
      requested_ref: sourceManifest.requested_ref || "",
      resolved_ref: sourceManifest.resolved_ref || "",
      integrity: sourceManifest.integrity || "",
      fetched_at: sourceManifest.fetched_at || "",
      snapshot_dir: sourceManifest.snapshot_dir || "",
      docs_dir: sourceManifest.docs_dir || "",
      trust_signals: sourceManifest.trust_signals || {}
    };
  }

  ensureDirForFile(outFile);
  fs.writeFileSync(outFile, JSON.stringify(index, null, 2), "utf8");

  return {
    ok: true,
    library,
    version,
    index_path: outFile,
    docs_count: docs.length,
    sections_count: sections.length,
    source_hash: sourceHash,
    source_manifest_path: sourceManifestPath ? path.resolve(sourceManifestPath) : ""
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
        "Re-run trail-docs build"
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
      "Run trail-docs build or verify index path"
    );
  }
}

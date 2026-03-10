import { hashText, normalizeAnchor, truncate } from "./utils.mjs";

const HEADING_REGEX = /^(#{1,6})\s+(.+?)\s*$/;

function extractCodeBlocks(lines) {
  const blocks = [];
  let inFence = false;
  let current = [];

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inFence) {
        blocks.push(current.join("\n").trim());
        current = [];
        inFence = false;
      } else {
        inFence = true;
      }
      continue;
    }

    if (inFence) {
      current.push(line);
    }
  }

  return blocks.filter((block) => block.length > 0);
}

function normalizeText(lines) {
  return lines
    .join("\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toDocId(relativePath) {
  let value = relativePath.replace(/\.md$/i, "");
  value = value.replace(/\/index$/i, "");
  if (!value || value.toLowerCase() === "readme") {
    return "readme";
  }
  return value;
}

export function parseMarkdownDocument(relativePath, content) {
  const lines = content.split(/\r?\n/);
  const headings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(HEADING_REGEX);
    if (!match) {
      continue;
    }

    headings.push({
      line: index + 1,
      heading: match[2].trim()
    });
  }

  if (headings.length === 0) {
    headings.push({ line: 1, heading: "Document" });
  }

  const docId = toDocId(relativePath);
  const docTitle = headings[0].heading || docId;
  const anchorCounts = new Map();
  const sections = [];

  for (let index = 0; index < headings.length; index += 1) {
    const currentHeading = headings[index];
    const nextHeading = headings[index + 1];
    const lineStart = currentHeading.line;
    const lineEnd = nextHeading ? nextHeading.line - 1 : lines.length;
    const sectionLines = lines.slice(lineStart - 1, lineEnd);
    const bodyLines = sectionLines.slice(1);
    const bodyLineRecords = bodyLines.map((line, offset) => ({
      line: lineStart + offset + 1,
      text: line
    }));
    const baseAnchor = normalizeAnchor(currentHeading.heading);
    const duplicateCount = anchorCounts.get(baseAnchor) || 0;
    anchorCounts.set(baseAnchor, duplicateCount + 1);
    const anchor = duplicateCount === 0 ? baseAnchor : `${baseAnchor}-${duplicateCount}`;
    const text = normalizeText(bodyLines);
    const codeBlocks = extractCodeBlocks(bodyLines);
    const sectionIdSource = `${docId}|${anchor}|${currentHeading.heading}|${lineStart}`;

    sections.push({
      section_id: `sec_${hashText(sectionIdSource).slice(0, 12)}`,
      doc_id: docId,
      anchor,
      heading: currentHeading.heading,
      line_start: lineStart,
      line_end: lineEnd,
      text,
      snippet: truncate(text || currentHeading.heading, 220),
      code_blocks: codeBlocks,
      _body_lines: bodyLineRecords
    });
  }

  return {
    doc: {
      doc_id: docId,
      title: docTitle,
      source_path: relativePath
    },
    sections
  };
}

#!/usr/bin/env node
import { CliError } from "./errors.mjs";
import { ERROR_CODE_NAMES, EXIT_CODES } from "./constants.mjs";
import { parseArgs } from "./utils.mjs";
import {
  runBootstrap,
  runBuild,
  runCite,
  runList,
  runOpen,
  runSearch,
  runStats,
  runUse
} from "./commands.mjs";

function usage() {
  return [
    "DocCLI",
    "",
    "Usage:",
    "  doccli bootstrap --src <dir> --library <name> --version <semver> [--docs-out <dir>] [--out <file>] [--emit-manifest] [--manifest-out <file>] [--json]",
    "  doccli build --src <dir> --library <name> --version <semver> [--out <file>] [--json]",
    "  doccli list [--index <file>] [--json]",
    "  doccli stats [--index <file>] [--json]",
    "  doccli search <query> [--index <file>] [--max-results <n>] [--json]",
    "  doccli open <doc_id#anchor> [--index <file>] [--max-chars <n>] [--json]",
    "  doccli cite <doc_id#anchor> [--index <file>] [--json]",
    "  doccli use <library> \"<task>\" [--path <dir>] [--max-results <n>] [--json]"
  ].join("\n");
}

function printHuman(command, payload) {
  if (command === "build") {
    console.log(`Built index: ${payload.index_path}`);
    console.log(`Docs: ${payload.docs_count}, sections: ${payload.sections_count}`);
    console.log(`Source hash: ${payload.source_hash}`);
    return;
  }

  if (command === "bootstrap") {
    console.log(`Generated docs: ${payload.generated_docs_file}`);
    console.log(`Scanned files: ${payload.source_files_scanned}, symbols: ${payload.symbols_detected}`);
    console.log(`Built index: ${payload.index_path}`);
    if (payload.manifest_path) {
      console.log(`Manifest: ${payload.manifest_path}`);
    }
    return;
  }

  if (command === "search") {
    console.log(`Results for "${payload.query}" in ${payload.library}@${payload.version}:`);
    if (payload.results.length === 0) {
      console.log("No matches.");
      return;
    }
    for (const result of payload.results) {
      console.log(`- [${result.score}] ${result.doc_id}#${result.anchor} :: ${result.heading}`);
    }
    return;
  }

  if (command === "list") {
    console.log(`Docs in ${payload.library}@${payload.version}:`);
    if (payload.docs.length === 0) {
      console.log("No docs indexed.");
      return;
    }
    for (const doc of payload.docs) {
      console.log(`- ${doc.doc_id} (${doc.sections} sections) :: ${doc.title}`);
    }
    return;
  }

  if (command === "stats") {
    console.log(`${payload.library}@${payload.version}`);
    console.log(`Docs: ${payload.docs_count}`);
    console.log(`Sections: ${payload.sections_count}`);
    console.log(`Code blocks: ${payload.code_blocks_count}`);
    console.log(`Sections per doc: ${payload.sections_per_doc}`);
    if (payload.built_at) {
      console.log(`Built at: ${payload.built_at}`);
    }
    if (payload.source_hash) {
      console.log(`Source hash: ${payload.source_hash}`);
    }
    return;
  }

  if (command === "open") {
    console.log(`${payload.doc_id}#${payload.anchor} (${payload.source_path}:${payload.line_start})`);
    console.log(payload.content);
    return;
  }

  if (command === "cite") {
    console.log(payload.citation_id);
    console.log(`${payload.source_path}:${payload.line_start}`);
    return;
  }

  if (command === "use") {
    console.log(`${payload.library}@${payload.version} :: ${payload.task} [${payload.confidence}]`);
    if (payload.steps.length === 0) {
      console.log("No citation-backed steps found for this task.");
      return;
    }
    for (const step of payload.steps) {
      const confidence = typeof step.confidence === "number" ? ` [confidence: ${step.confidence}]` : "";
      console.log(`${step.id}${confidence}. ${step.instruction}`);
      if (step.command) {
        console.log(`  command: ${step.command}`);
      }
      if (step.prerequisites) {
        console.log(`  prerequisites: ${step.prerequisites}`);
      }
      if (step.expected) {
        console.log(`  expected: ${step.expected}`);
      }
      console.log(`  cite: ${step.citations.join(", ")}`);
    }
    if (payload.snippet) {
      console.log("\nSnippet:\n");
      console.log(payload.snippet);
    }
    if (Array.isArray(payload.related_docs) && payload.related_docs.length > 0) {
      console.log(`\nRelated docs: ${payload.related_docs.join(", ")}`);
    }
  }
}

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function handleError(error, asJson) {
  if (error instanceof CliError) {
    if (asJson) {
      printJson({
        error: {
          code: error.code,
          message: error.message,
          hint: error.hint
        }
      });
    } else {
      console.error(`${error.code}: ${error.message}`);
      if (error.hint) {
        console.error(`Hint: ${error.hint}`);
      }
    }
    process.exit(error.exitCode);
  }

  const exitCode = EXIT_CODES.INTERNAL_ERROR;
  const code = ERROR_CODE_NAMES[exitCode] || "INTERNAL_ERROR";
  if (asJson) {
    printJson({
      error: {
        code,
        message: error?.message || "Unexpected internal error",
        hint: "Re-run with a simpler input or inspect stack trace"
      }
    });
  } else {
    console.error(`${code}: ${error?.message || "Unexpected internal error"}`);
  }
  process.exit(exitCode);
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  const parsed = parseArgs(argv.slice(1));
  const asJson = Boolean(parsed.flags.json);

  try {
    if (parsed.flags.help) {
      console.log(usage());
      return;
    }

    let payload;
    if (command === "bootstrap") {
      payload = runBootstrap(parsed.flags);
    } else if (command === "build") {
      payload = runBuild(parsed.flags);
    } else if (command === "search") {
      payload = runSearch(parsed.positionals, parsed.flags);
    } else if (command === "list") {
      payload = runList(parsed.flags);
    } else if (command === "stats") {
      payload = runStats(parsed.flags);
    } else if (command === "open") {
      payload = runOpen(parsed.positionals, parsed.flags);
    } else if (command === "cite") {
      payload = runCite(parsed.positionals, parsed.flags);
    } else if (command === "use") {
      payload = runUse(parsed.positionals, parsed.flags);
    } else {
      throw new CliError(
        EXIT_CODES.INVALID_ARGS,
        "INVALID_ARGS",
        `Unknown command: ${command}`,
        "Run doccli --help"
      );
    }

    if (asJson) {
      printJson(payload);
      return;
    }
    printHuman(command, payload);
  } catch (error) {
    handleError(error, asJson);
  }
}

main();

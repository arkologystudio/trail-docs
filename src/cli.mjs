#!/usr/bin/env node
import { CliError } from "./errors.mjs";
import { ERROR_CODE_NAMES, EXIT_CODES } from "./constants.mjs";
import { parseArgs } from "./utils.mjs";
import { runBootstrap, runBuild, runCite, runOpen, runSearch, runUse } from "./commands.mjs";

function usage() {
  return [
    "DocCLI",
    "",
    "Usage:",
    "  doccli bootstrap --src <dir> --library <name> --version <semver> [--docs-out <dir>] [--out <file>] [--emit-manifest] [--manifest-out <file>] [--json]",
    "  doccli build --src <dir> --library <name> --version <semver> [--out <file>] [--json]",
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
    console.log(`${payload.library}@${payload.version} :: ${payload.task}`);
    if (payload.steps.length === 0) {
      console.log("No citation-backed steps found for this task.");
      return;
    }
    for (const step of payload.steps) {
      console.log(`${step.id}. ${step.instruction}`);
      console.log(`  cite: ${step.citations.join(", ")}`);
    }
    if (payload.snippet) {
      console.log("\nSnippet:\n");
      console.log(payload.snippet);
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

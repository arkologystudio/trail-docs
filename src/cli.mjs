#!/usr/bin/env node
import { CliError } from "./errors.mjs";
import { ERROR_CODE_NAMES, EXIT_CODES } from "./constants.mjs";
import { parseArgs } from "./utils.mjs";
import { applyConfigDefaults, loadProjectConfig } from "./config.mjs";
import {
  runBootstrap,
  runBuild,
  runCite,
  runDiscover,
  runFetch,
  runIndex,
  runFn,
  runList,
  runOpen,
  runPrep,
  runSearch,
  runSurface,
  runStats,
  runUse
} from "./commands.mjs";

function usage() {
  return [
    "DocCLI",
    "",
    "Usage:",
    "  doc-nav bootstrap --src <dir> --library <name> --version <semver> [--docs-out <dir>] [--out <file>] [--emit-manifest] [--manifest-out <file>] [--json]",
    "  doc-nav build --src <dir> --library <name> --version <semver> [--source-manifest <file>] [--out <file>] [--json]",
    "  doc-nav list [--index <file>] [--json]",
    "  doc-nav stats [--index <file>] [--json]",
    "  doc-nav discover <query> [--provider <all|catalog|npm|github>] [--catalog <file>] [--ecosystem <name>] [--max-results <n>] [--json]",
    "  doc-nav fetch <selector> [--version <semver>] [--ref <git-ref>] [--out <dir>] [--cache-dir <dir>] [--policy <file>] [--json]",
    "  doc-nav prep <query_or_selector_or_url> [--path <dir>] [--out <file>] [--manifest-out <file>] [--choose <n>] [--json]",
    "  doc-nav index <query_or_selector_or_url> [--path <dir>] [--out <file>] [--manifest-out <file>] [--choose <n>] [--json]",
    "  doc-nav surface <selector> [--symbol-kind <all|function|class|method|type>] [--max-results <n>] [--examples <n>] [--cache-dir <dir>] [--json]",
    "  doc-nav fn <selector#symbol_query> [--examples <n>] [--cache-dir <dir>] [--json]",
    "  doc-nav search <query> [--index <file>] [--indexes <f1,f2,...>] [--max-results <n>] [--json]",
    "  doc-nav open <doc_id#anchor> [--index <file>] [--max-chars <n>] [--json]",
    "  doc-nav cite <doc_id#anchor> [--index <file>] [--json]",
    "  doc-nav use <library> \"<task>\" [--path <dir>] [--max-results <n>] [--no-auto-heal] [--json]",
    "  doc-nav use \"<task>\" --libs <selector1,selector2,...> [--max-results <n>] [--json]",
    "  doc-nav use \"<task>\" --indexes <i1,i2,...> [--max-results <n>] [--json]"
  ].join("\n");
}

function printHuman(command, payload) {
  if (command === "build") {
    console.log(`Built index: ${payload.index_path}`);
    console.log(`Docs: ${payload.docs_count}, sections: ${payload.sections_count}`);
    console.log(`Source hash: ${payload.source_hash}`);
    if (payload.source_manifest_path) {
      console.log(`Source manifest: ${payload.source_manifest_path}`);
    }
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

  if (command === "prep" || command === "index") {
    console.log(`Prepared ${payload.library}@${payload.version}`);
    console.log(`Selector: ${payload.selector}`);
    console.log(`Index: ${payload.index_path}`);
    console.log(`Manifest: ${payload.manifest_path}`);
    return;
  }

  if (command === "search") {
    if (payload.mode === "federated") {
      console.log(`Federated results for "${payload.query}":`);
      if (!Array.isArray(payload.results) || payload.results.length === 0) {
        console.log("No matches.");
        return;
      }
      for (const result of payload.results) {
        console.log(
          `- [${result.score}] ${result.library}@${result.version} :: ${result.doc_id}#${result.anchor}`
        );
      }
      return;
    }
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

  if (command === "discover") {
    console.log(`Discovery results for "${payload.query}" (${payload.provider}):`);
    if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) {
      console.log("No candidates found.");
      return;
    }
    for (const candidate of payload.candidates) {
      console.log(
        `- [${candidate.confidence}] ${candidate.name} (${candidate.source_type}) -> ${candidate.selector}`
      );
    }
    return;
  }

  if (command === "fetch") {
    console.log(`Fetched ${payload.library}@${payload.version}`);
    console.log(`Source: ${payload.canonical_url}`);
    console.log(`Docs dir: ${payload.docs_dir}`);
    console.log(`Manifest: ${payload.source_manifest_path}`);
    if (payload.cache_hit) {
      console.log("Cache: hit");
    }
    return;
  }

  if (command === "surface") {
    console.log(`${payload.library}@${payload.version} (${payload.confidence})`);
    console.log(`Exports: ${payload.exports.length}, symbols: ${payload.symbols.length}`);
    for (const entry of payload.exports.slice(0, 12)) {
      console.log(`- ${entry.export_name} (${entry.kind}) -> ${entry.symbol_id}`);
    }
    return;
  }

  if (command === "fn") {
    console.log(`${payload.selector}#${payload.symbol_query} [${payload.match_type}]`);
    console.log(`${payload.symbol.fq_name} (${payload.symbol.kind})`);
    for (const signature of payload.symbol.signatures || []) {
      console.log(`- ${signature}`);
    }
    if (payload.examples?.length > 0) {
      console.log(`Examples: ${payload.examples.length}`);
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
    if (payload.mode === "multi_library") {
      console.log(`Task: ${payload.task}`);
      if (!Array.isArray(payload.recommendations) || payload.recommendations.length === 0) {
        console.log("No callable recommendations found.");
        return;
      }
      for (const recommendation of payload.recommendations) {
        console.log(
          `${recommendation.rank}. ${recommendation.library} -> ${recommendation.fq_name} [${recommendation.confidence}]`
        );
        if (recommendation.signature) {
          console.log(`  signature: ${recommendation.signature}`);
        }
        console.log(`  why: ${recommendation.why}`);
        console.log(`  cite: ${recommendation.citation_id}`);
      }
      return;
    }
    if (payload.mode === "federated_docs") {
      console.log(`Task: ${payload.task} [${payload.confidence}]`);
      if (!Array.isArray(payload.steps) || payload.steps.length === 0) {
        console.log("No citation-backed steps found.");
        return;
      }
      for (const step of payload.steps) {
        console.log(`${step.id} (${step.library}@${step.version}). ${step.instruction}`);
        console.log(`  cite: ${step.citations.join(", ")}`);
      }
      return;
    }

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

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  const parsed = parseArgs(argv.slice(1));
  const loadedConfig = loadProjectConfig(process.cwd());
  const applied = applyConfigDefaults({
    command,
    positionals: parsed.positionals,
    flags: parsed.flags,
    config: loadedConfig.config
  });
  const effectiveFlags = applied.flags;
  const effectivePositionals = applied.positionals;
  const asJson = Boolean(effectiveFlags.json);

  try {
    if (effectiveFlags.help) {
      console.log(usage());
      return;
    }

    let payload;
    if (command === "bootstrap") {
      payload = runBootstrap(effectiveFlags);
    } else if (command === "build") {
      payload = runBuild(effectiveFlags);
    } else if (command === "discover") {
      payload = await runDiscover(effectivePositionals, effectiveFlags);
    } else if (command === "fetch") {
      payload = await runFetch(effectivePositionals, effectiveFlags);
    } else if (command === "prep") {
      payload = await runPrep(effectivePositionals, effectiveFlags);
    } else if (command === "index") {
      payload = await runIndex(effectivePositionals, effectiveFlags);
    } else if (command === "surface") {
      payload = await runSurface(effectivePositionals, effectiveFlags);
    } else if (command === "fn") {
      payload = await runFn(effectivePositionals, effectiveFlags);
    } else if (command === "search") {
      payload = runSearch(effectivePositionals, effectiveFlags);
    } else if (command === "list") {
      payload = runList(effectiveFlags);
    } else if (command === "stats") {
      payload = runStats(effectiveFlags);
    } else if (command === "open") {
      payload = runOpen(effectivePositionals, effectiveFlags);
    } else if (command === "cite") {
      payload = runCite(effectivePositionals, effectiveFlags);
    } else if (command === "use") {
      payload = await runUse(effectivePositionals, effectiveFlags);
    } else {
      throw new CliError(
        EXIT_CODES.INVALID_ARGS,
        "INVALID_ARGS",
        `Unknown command: ${command}`,
        "Run doc-nav --help"
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

main().catch((error) => {
  handleError(error, false);
});

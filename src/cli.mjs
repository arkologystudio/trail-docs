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
  runExpand,
  runExtract,
  runFetch,
  runFind,
  runIndex,
  runFn,
  runList,
  runNeighbors,
  runOpen,
  runPrep,
  runSearch,
  runSurface,
  runStats,
  runTrail
} from "./commands.mjs";

function usage() {
  return [
    "Trail Docs",
    "",
    "Usage:",
    "  trail-docs bootstrap --src <dir> --library <name> --version <semver> [--docs-out <dir>] [--out <file>] [--emit-manifest] [--manifest-out <file>] [--json]",
    "  trail-docs build --src <dir> --library <name> --version <semver> [--source-manifest <file>] [--out <file>] [--json]",
    "  trail-docs list [--index <file>] [--json]",
    "  trail-docs stats [--index <file>] [--json]",
    "  trail-docs discover <query> [--provider <all|catalog|npm|github>] [--catalog <file>] [--ecosystem <name>] [--max-results <n>] [--json]",
    "  trail-docs fetch <selector> [--version <semver>] [--ref <git-ref>] [--out <dir>] [--cache-dir <dir>] [--policy <file>] [--json]",
    "  trail-docs prep <query_or_selector_or_url> [--path <dir>] [--out <file>] [--manifest-out <file>] [--choose <n>] [--json]",
    "  trail-docs index <query_or_selector_or_url> [--path <dir>] [--out <file>] [--manifest-out <file>] [--choose <n>] [--json]",
    "  trail-docs surface <selector> [--symbol-kind <all|function|class|method|type>] [--max-results <n>] [--examples <n>] [--cache-dir <dir>] [--json]",
    "  trail-docs fn <selector#symbol_query> [--examples <n>] [--cache-dir <dir>] [--json]",
    "  trail-docs find <query> [--index <file>] [--budget <tokens>] [--max-items <n>] [--json]",
    "  trail-docs search <query> [--index <file>] [--budget <tokens>] [--max-items <n>] [--json]",
    "  trail-docs expand <doc_id#anchor> [--index <file>] [--budget <tokens>] [--max-items <n>] [--json]",
    "  trail-docs neighbors <doc_id#anchor> [--index <file>] [--json]",
    "  trail-docs extract <query> --from <ref1,ref2,...> [--index <file>] [--budget <tokens>] [--max-items <n>] [--json]",
    "  trail-docs open <doc_id#anchor> [--index <file>] [--mode <section|units>] [--budget <tokens>] [--max-items <n>] [--json]",
    "  trail-docs cite <doc_id#anchor> [--index <file>] [--json]",
    "  trail-docs trail create --objective \"<text>\" [--trail <id>] [--json]",
    "  trail-docs trail add --trail <id> --ref <doc_id#anchor> [--index <file>] [--json]",
    "  trail-docs trail pin --trail <id> --citation <citation_id> [--json]",
    "  trail-docs trail tag --trail <id> --tag <tag> [--json]",
    "  trail-docs trail show --trail <id> [--json]"
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

  if (command === "find" || command === "search") {
    console.log(`Results for "${payload.query}" in ${payload.library}@${payload.version}:`);
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      console.log("No matches.");
      return;
    }
    for (const item of payload.items) {
      console.log(`- ${item.ref} [est_tokens=${item.est_tokens}]`);
      if (Array.isArray(item.top_units)) {
        for (const unit of item.top_units) {
          console.log(`  • ${unit.type} [${unit.score}] ${unit.text}`);
        }
      }
    }
    return;
  }

  if (command === "expand" || command === "extract") {
    console.log(`${command} in ${payload.library}@${payload.version}`);
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      console.log("No evidence units selected.");
      return;
    }
    for (const item of payload.items) {
      console.log(`- ${item.ref} [${item.type}] [${item.score}] ${item.text}`);
      console.log(`  cite: ${item.citation_id}`);
    }
    console.log(`Budget: ${payload.spent_tokens}/${payload.budget_tokens}`);
    return;
  }

  if (command === "neighbors") {
    console.log(`Neighbors for ${payload.ref} in ${payload.library}@${payload.version}`);
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      console.log("No neighbors.");
      return;
    }
    for (const item of payload.items) {
      console.log(`- ${item.edge_type}: ${item.ref}`);
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
    if (payload.mode === "section") {
      console.log(`${payload.doc_id}#${payload.anchor} (${payload.source_path}:${payload.line_start})`);
      console.log(payload.content);
      return;
    }
    console.log(`Units for ${payload.ref} in ${payload.library}@${payload.version}`);
    for (const item of payload.items || []) {
      console.log(`- [${item.type}] ${item.text}`);
      console.log(`  cite: ${item.citation_id}`);
    }
    console.log(`Budget: ${payload.spent_tokens}/${payload.budget_tokens}`);
    return;
  }

  if (command === "cite") {
    console.log(payload.citation_id);
    console.log(`${payload.source_path}:${payload.line_start}`);
    return;
  }

  if (command === "trail") {
    console.log(`Trail: ${payload.trail_id}`);
    console.log(`Objective: ${payload.objective}`);
    console.log(`Visited refs: ${(payload.visited_refs || []).length}`);
    console.log(`Pinned evidence: ${(payload.pinned_evidence || []).length}`);
    console.log(`Coverage tags: ${(payload.coverage_tags || []).length}`);
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
    } else if (command === "find") {
      payload = runFind(effectivePositionals, effectiveFlags);
    } else if (command === "search") {
      payload = runSearch(effectivePositionals, effectiveFlags);
    } else if (command === "expand") {
      payload = runExpand(effectivePositionals, effectiveFlags);
    } else if (command === "neighbors") {
      payload = runNeighbors(effectivePositionals, effectiveFlags);
    } else if (command === "extract") {
      payload = runExtract(effectivePositionals, effectiveFlags);
    } else if (command === "list") {
      payload = runList(effectiveFlags);
    } else if (command === "stats") {
      payload = runStats(effectiveFlags);
    } else if (command === "open") {
      payload = runOpen(effectivePositionals, effectiveFlags);
    } else if (command === "cite") {
      payload = runCite(effectivePositionals, effectiveFlags);
    } else if (command === "trail") {
      payload = runTrail(effectivePositionals, effectiveFlags);
    } else {
      throw new CliError(
        EXIT_CODES.INVALID_ARGS,
        "INVALID_ARGS",
        `Unknown command: ${command}`,
        "Run trail-docs --help"
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

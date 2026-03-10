import fs from "node:fs";

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mean(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value) {
  return Number(toNumber(value).toFixed(4));
}

export function parseJsonl(content) {
  return String(content || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function computeToolAggregate(records) {
  const grouped = new Map();
  for (const record of records) {
    const key = String(record.tool || "unknown");
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(record);
  }

  const aggregates = [];

  for (const [tool, rows] of grouped.entries()) {
    const okRows = rows.filter((entry) => entry.ok === true);
    const comprehension = okRows.map((entry) => toNumber(entry.comprehension_score));
    const tokens = okRows.map((entry) => toNumber(entry.total_tokens));
    const latency = okRows.map((entry) => toNumber(entry.total_latency_ms));
    const firstHopPrecision = okRows.map((entry) => toNumber(entry.first_hop_precision_at_k));
    const coverage2 = okRows.map((entry) => toNumber(entry.coverage_after_2_hops));
    const coverage3 = okRows.map((entry) => toNumber(entry.coverage_after_3_hops));
    const tokensPerPoint = okRows.map((entry) => toNumber(entry.tokens_per_required_point)).filter((entry) => entry > 0);
    const duplicateRatio = okRows.map((entry) => toNumber(entry.duplicate_context_ratio));
    const citationPrecision = okRows.map((entry) => toNumber(entry.citation_precision_line_level));
    const abstainRate = rows.map((entry) => toNumber(entry.abstain_when_unknown_rate));

    aggregates.push({
      tool,
      runs: rows.length,
      successful_runs: okRows.length,
      success_rate: round(rows.length === 0 ? 0 : okRows.length / rows.length),
      mean_comprehension: round(mean(comprehension)),
      median_comprehension: round(median(comprehension)),
      mean_total_tokens: round(mean(tokens)),
      p95_total_tokens: round(percentile(tokens, 95)),
      mean_total_latency_ms: round(mean(latency)),
      p95_total_latency_ms: round(percentile(latency, 95)),
      mean_first_hop_precision_at_k: round(mean(firstHopPrecision)),
      mean_coverage_after_2_hops: round(mean(coverage2)),
      mean_coverage_after_3_hops: round(mean(coverage3)),
      mean_tokens_per_required_point: round(mean(tokensPerPoint)),
      mean_duplicate_context_ratio: round(mean(duplicateRatio)),
      mean_citation_precision_line_level: round(mean(citationPrecision)),
      mean_abstain_when_unknown_rate: round(mean(abstainRate))
    });
  }

  aggregates.sort((a, b) => b.mean_comprehension - a.mean_comprehension);
  return aggregates;
}

function pairwiseTools(aggregates) {
  const tools = aggregates.map((entry) => entry.tool);
  const pairs = [];
  for (let i = 0; i < tools.length; i += 1) {
    for (let j = i + 1; j < tools.length; j += 1) {
      pairs.push([tools[i], tools[j]]);
    }
  }
  return pairs;
}

export function computePairwiseDeltas(records, aggregates) {
  const byTool = new Map();
  for (const row of records) {
    if (!byTool.has(row.tool)) {
      byTool.set(row.tool, new Map());
    }
    byTool.get(row.tool).set(`${row.case_id}::${row.pass_index}`, row);
  }

  const byToolAgg = new Map(aggregates.map((entry) => [entry.tool, entry]));
  const deltas = [];

  for (const [leftTool, rightTool] of pairwiseTools(aggregates)) {
    const leftRows = byTool.get(leftTool) || new Map();
    const rightRows = byTool.get(rightTool) || new Map();

    let compared = 0;
    let leftWins = 0;
    let rightWins = 0;

    for (const [key, left] of leftRows.entries()) {
      const right = rightRows.get(key);
      if (!right || !left.ok || !right.ok) {
        continue;
      }
      compared += 1;
      if (toNumber(left.comprehension_score) > toNumber(right.comprehension_score)) {
        leftWins += 1;
      } else if (toNumber(right.comprehension_score) > toNumber(left.comprehension_score)) {
        rightWins += 1;
      }
    }

    const leftAgg = byToolAgg.get(leftTool) || {};
    const rightAgg = byToolAgg.get(rightTool) || {};

    deltas.push({
      pair: `${leftTool} vs ${rightTool}`,
      compared_cases: compared,
      mean_comprehension_delta: round(toNumber(leftAgg.mean_comprehension) - toNumber(rightAgg.mean_comprehension)),
      mean_tokens_delta: round(toNumber(leftAgg.mean_total_tokens) - toNumber(rightAgg.mean_total_tokens)),
      mean_latency_ms_delta: round(
        toNumber(leftAgg.mean_total_latency_ms) - toNumber(rightAgg.mean_total_latency_ms)
      ),
      left_win_rate: round(compared === 0 ? 0 : leftWins / compared),
      right_win_rate: round(compared === 0 ? 0 : rightWins / compared)
    });
  }

  return deltas;
}

export function buildSummary(records) {
  const aggregates = computeToolAggregate(records);
  const pairwise = computePairwiseDeltas(records, aggregates);
  return {
    generated_at: new Date().toISOString(),
    total_runs: records.length,
    per_tool: aggregates,
    pairwise
  };
}

export function toMarkdown(summary, records) {
  const lines = [];
  lines.push("# Trail-Docs Benchmark Report");
  lines.push("");
  lines.push(`Generated: ${summary.generated_at}`);
  lines.push(`Total runs: ${summary.total_runs}`);
  lines.push("");

  lines.push("## Tool Scoreboard");
  lines.push("");
  lines.push(
    "| Tool | Success Rate | Mean Comp. | Mean 1st Hop P@K | Mean Cov@2 | Mean Cov@3 | Mean Tokens | P95 Tokens | Mean Latency (ms) | P95 Latency (ms) | Mean Dup Ratio | Mean Citation Precision |"
  );
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of summary.per_tool) {
    lines.push(
      `| ${row.tool} | ${row.success_rate} | ${row.mean_comprehension} | ${row.mean_first_hop_precision_at_k} | ${row.mean_coverage_after_2_hops} | ${row.mean_coverage_after_3_hops} | ${row.mean_total_tokens} | ${row.p95_total_tokens} | ${row.mean_total_latency_ms} | ${row.p95_total_latency_ms} | ${row.mean_duplicate_context_ratio} | ${row.mean_citation_precision_line_level} |`
    );
  }
  lines.push("");

  lines.push("## Pairwise Deltas");
  lines.push("");
  lines.push(
    "| Pair | Compared Cases | Comp Delta | Tokens Delta | Latency Delta (ms) | Left Win Rate | Right Win Rate |"
  );
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const row of summary.pairwise) {
    lines.push(
      `| ${row.pair} | ${row.compared_cases} | ${row.mean_comprehension_delta} | ${row.mean_tokens_delta} | ${row.mean_latency_ms_delta} | ${row.left_win_rate} | ${row.right_win_rate} |`
    );
  }
  lines.push("");

  lines.push("## Case Breakdown");
  lines.push("");
  lines.push("| Case | Tool | Pass | OK | Comp. | Tokens | Latency (ms) | Error |");
  lines.push("|---|---|---:|---|---:|---:|---:|---|");

  const sorted = [...records].sort((a, b) => {
    if (a.case_id !== b.case_id) {
      return String(a.case_id).localeCompare(String(b.case_id));
    }
    if (a.tool !== b.tool) {
      return String(a.tool).localeCompare(String(b.tool));
    }
    return toNumber(a.pass_index) - toNumber(b.pass_index);
  });

  for (const row of sorted) {
    lines.push(
      `| ${row.case_id} | ${row.tool} | ${row.pass_index} | ${row.ok ? "yes" : "no"} | ${toNumber(
        row.comprehension_score
      ).toFixed(4)} | ${toNumber(row.total_tokens).toFixed(0)} | ${toNumber(row.total_latency_ms).toFixed(2)} | ${
        row.error ? String(row.error).replace(/\|/g, "/") : ""
      } |`
    );
  }

  lines.push("");
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { input: "", jsonOut: "", mdOut: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--input") {
      args.input = argv[i + 1] || "";
      i += 1;
    } else if (token === "--json-out") {
      args.jsonOut = argv[i + 1] || "";
      i += 1;
    } else if (token === "--md-out") {
      args.mdOut = argv[i + 1] || "";
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    throw new Error("Usage: node eval/src/report.mjs --input <raw.jsonl> --json-out <summary.json> --md-out <report.md>");
  }

  const raw = fs.readFileSync(args.input, "utf8");
  const records = parseJsonl(raw);
  const summary = buildSummary(records);
  const markdown = toMarkdown(summary, records);

  if (args.jsonOut) {
    fs.writeFileSync(args.jsonOut, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  if (args.mdOut) {
    fs.writeFileSync(args.mdOut, `${markdown}\n`, "utf8");
  }

  if (!args.jsonOut && !args.mdOut) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

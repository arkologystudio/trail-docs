import fs from "node:fs";

function parseArgs(argv) {
  const args = {
    summary: "",
    baseline: "",
    previous: "",
    requireContext7: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--summary") {
      args.summary = argv[i + 1] || "";
      i += 1;
    } else if (token === "--baseline") {
      args.baseline = argv[i + 1] || "";
      i += 1;
    } else if (token === "--previous") {
      args.previous = argv[i + 1] || "";
      i += 1;
    } else if (token === "--require-context7") {
      args.requireContext7 = true;
    }
  }

  return args;
}

function loadSummary(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toolRow(summary, tool) {
  return (summary?.per_tool || []).find((entry) => entry.tool === tool) || null;
}

function check(name, pass, details) {
  return { name, pass: Boolean(pass), details };
}

function nearEqual(a, b, tolerance = 0.0001) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.summary || !args.baseline) {
    throw new Error("Usage: node eval/src/check-gates.mjs --summary <summary.json> --baseline <summary.json> [--previous <summary.json>] [--require-context7]");
  }

  const summary = loadSummary(args.summary);
  const baseline = loadSummary(args.baseline);

  const currentTrail = toolRow(summary, "trail-docs");
  const baselineTrail = toolRow(baseline, "trail-docs");

  if (!currentTrail || !baselineTrail) {
    throw new Error("Could not find trail-docs rows in summary or baseline");
  }

  const checks = [];

  checks.push(
    check(
      "trail_docs_comprehension_plus_0_08",
      Number(currentTrail.mean_comprehension) >= Number(baselineTrail.mean_comprehension) + 0.08,
      {
        current: currentTrail.mean_comprehension,
        baseline: baselineTrail.mean_comprehension,
        required_min: Number((Number(baselineTrail.mean_comprehension) + 0.08).toFixed(4))
      }
    )
  );

  checks.push(
    check(
      "trail_docs_tokens_minus_20pct",
      Number(currentTrail.mean_total_tokens) <= Number(baselineTrail.mean_total_tokens) * 0.8,
      {
        current: currentTrail.mean_total_tokens,
        baseline: baselineTrail.mean_total_tokens,
        required_max: Number((Number(baselineTrail.mean_total_tokens) * 0.8).toFixed(4))
      }
    )
  );

  checks.push(
    check("trail_docs_success_rate_gte_0_99", Number(currentTrail.success_rate) >= 0.99, {
      current: currentTrail.success_rate,
      required_min: 0.99
    })
  );

  const baselineDup = Number(baselineTrail.mean_duplicate_context_ratio || 0);
  const requiredDupMax = baselineDup === 0 ? 0 : baselineDup * 0.6;
  checks.push(
    check(
      "trail_docs_duplicate_ratio_minus_40pct",
      Number(currentTrail.mean_duplicate_context_ratio) <= requiredDupMax,
      {
        current: currentTrail.mean_duplicate_context_ratio,
        baseline: baselineDup,
        required_max: Number(requiredDupMax.toFixed(4))
      }
    )
  );

  checks.push(
    check(
      "trail_docs_citation_precision_gte_baseline",
      Number(currentTrail.mean_citation_precision_line_level) >= Number(baselineTrail.mean_citation_precision_line_level || 0),
      {
        current: currentTrail.mean_citation_precision_line_level,
        baseline: baselineTrail.mean_citation_precision_line_level || 0
      }
    )
  );

  const currentContext7 = toolRow(summary, "context7");
  if (currentContext7 && Number(currentContext7.success_rate) > 0) {
    checks.push(
      check(
        "vs_context7_comprehension_gap_lte_0_03",
        Number(currentContext7.mean_comprehension) - Number(currentTrail.mean_comprehension) <= 0.03,
        {
          trail_docs: currentTrail.mean_comprehension,
          context7: currentContext7.mean_comprehension,
          gap: Number((Number(currentContext7.mean_comprehension) - Number(currentTrail.mean_comprehension)).toFixed(4)),
          required_max_gap: 0.03
        }
      )
    );

    checks.push(
      check(
        "vs_context7_tokens_minus_15pct",
        Number(currentTrail.mean_total_tokens) <= Number(currentContext7.mean_total_tokens) * 0.85,
        {
          trail_docs: currentTrail.mean_total_tokens,
          context7: currentContext7.mean_total_tokens,
          required_max: Number((Number(currentContext7.mean_total_tokens) * 0.85).toFixed(4))
        }
      )
    );

    checks.push(
      check(
        "vs_context7_p95_latency_lower",
        Number(currentTrail.p95_total_latency_ms) < Number(currentContext7.p95_total_latency_ms),
        {
          trail_docs: currentTrail.p95_total_latency_ms,
          context7: currentContext7.p95_total_latency_ms
        }
      )
    );
  } else {
    checks.push(
      check(
        "vs_context7_checks_available",
        args.requireContext7 ? false : true,
        {
          context7_success_rate: currentContext7 ? currentContext7.success_rate : 0,
          reason: "Context7 unavailable for comparison"
        }
      )
    );
  }

  if (args.previous) {
    const previous = loadSummary(args.previous);
    const previousTrail = toolRow(previous, "trail-docs");
    if (previousTrail) {
      checks.push(
        check(
          "two_consecutive_runs_stable",
          nearEqual(previousTrail.mean_comprehension, currentTrail.mean_comprehension) &&
            nearEqual(previousTrail.mean_total_tokens, currentTrail.mean_total_tokens) &&
            nearEqual(previousTrail.success_rate, currentTrail.success_rate),
          {
            previous: {
              mean_comprehension: previousTrail.mean_comprehension,
              mean_total_tokens: previousTrail.mean_total_tokens,
              success_rate: previousTrail.success_rate
            },
            current: {
              mean_comprehension: currentTrail.mean_comprehension,
              mean_total_tokens: currentTrail.mean_total_tokens,
              success_rate: currentTrail.success_rate
            }
          }
        )
      );
    }
  }

  const passed = checks.every((entry) => entry.pass);
  const payload = {
    ok: passed,
    summary: args.summary,
    baseline: args.baseline,
    checks
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (!passed) {
    process.exit(1);
  }
}

main();

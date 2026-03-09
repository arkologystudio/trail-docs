import { extractAnswerCitations, scoreCitations, scoreRequiredPoints } from "./scoring.mjs";

function envOrDefault(value, fallback) {
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function extractOutputText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
      if (part?.type === "text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

async function callOpenAI({ model, temperature, maxOutputTokens, system, user }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for provider=openai");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature,
      max_output_tokens: maxOutputTokens,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: system }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: user }]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI error (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const usage = {
    prompt_tokens: Number(payload?.usage?.input_tokens || 0),
    completion_tokens: Number(payload?.usage?.output_tokens || 0),
    total_tokens: Number(payload?.usage?.total_tokens || 0)
  };

  return {
    text: extractOutputText(payload),
    usage,
    raw: payload
  };
}

function buildContextText(contextBlocks) {
  const blocks = Array.isArray(contextBlocks) ? contextBlocks : [];
  return blocks
    .map((block, index) => {
      const citationLine = block?.citation ? `Citation: ${block.citation}` : "Citation: unknown";
      return `Block ${index + 1}\n${citationLine}\n${String(block?.text || "").trim()}`;
    })
    .join("\n\n");
}

function buildAnswerPrompt(question, contextBlocks) {
  const context = buildContextText(contextBlocks);
  return {
    system:
      "You are a documentation assistant. Answer only from provided context. If unsure, say so. Always include at least one citation in square brackets.",
    user: [
      `Question: ${question}`,
      "",
      "Context:",
      context || "(no context)",
      "",
      "Return format:",
      "- A concise answer (3-8 sentences)",
      "- A final line: Citations: [citation1], [citation2]"
    ].join("\n")
  };
}

function mockAnswer(question, contextBlocks) {
  const context = Array.isArray(contextBlocks) ? contextBlocks : [];
  const first = context[0] || { text: "No context found.", citation: "none" };
  const second = context[1] || null;

  let summary = `Based on the retrieved documentation, ${question}`;
  summary += ` ${String(first.text || "").split("\n")[0]}`;
  if (second?.text) {
    summary += ` ${String(second.text).split("\n")[0]}`;
  }

  const citations = context
    .map((entry) => entry?.citation)
    .filter(Boolean)
    .slice(0, 3);

  return {
    text: `${summary}\n\nCitations: ${citations.map((entry) => `[${entry}]`).join(", ") || "[none]"}`,
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    },
    meta: {
      provider: "mock",
      generated_at: nowIso()
    }
  };
}

export async function generateAnswer({ question, contextBlocks, config }) {
  const provider = envOrDefault(process.env.EVAL_MODEL_PROVIDER, config?.provider || "openai");
  const model = envOrDefault(process.env.EVAL_MODEL, config?.model || "gpt-4.1-mini");
  const temperature = Number.isFinite(config?.temperature) ? config.temperature : 0;
  const maxOutputTokens = Number.isFinite(config?.max_output_tokens) ? config.max_output_tokens : 500;

  if (provider === "mock") {
    return {
      ...mockAnswer(question, contextBlocks),
      provider,
      model: "mock-v1"
    };
  }

  if (provider !== "openai") {
    throw new Error(`Unsupported answer provider: ${provider}`);
  }

  const prompt = buildAnswerPrompt(question, contextBlocks);
  const result = await callOpenAI({
    model,
    temperature,
    maxOutputTokens,
    system: prompt.system,
    user: prompt.user
  });

  return {
    text: result.text,
    usage: result.usage,
    provider,
    model
  };
}

function parseJudgeJson(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(1, n));
}

function mockJudge({ answerText, benchCase }) {
  const required = scoreRequiredPoints(answerText, benchCase.required_points || []).score;
  const citations = scoreCitations(
    extractAnswerCitations(answerText),
    benchCase.acceptable_citations || [],
    answerText
  ).score;
  return Number((required * 0.7 + citations * 0.3).toFixed(4));
}

export async function judgeAnswer({ question, answerText, contextBlocks, benchCase, config }) {
  const provider = envOrDefault(process.env.EVAL_JUDGE_PROVIDER, config?.provider || "openai");
  const model = envOrDefault(process.env.EVAL_JUDGE_MODEL, config?.model || "gpt-4.1-mini");

  if (provider === "mock") {
    return {
      judge_score: mockJudge({ answerText, benchCase }),
      provider,
      model: "mock-v1",
      raw: null
    };
  }

  if (provider !== "openai") {
    throw new Error(`Unsupported judge provider: ${provider}`);
  }

  const temperature = Number.isFinite(config?.temperature) ? config.temperature : 0;
  const maxOutputTokens = Number.isFinite(config?.max_output_tokens) ? config.max_output_tokens : 300;

  const rubric = {
    correctness: "Does the answer match the question and required points?",
    completeness: "Does it cover the critical information from context?",
    groundedness: "Are statements grounded in provided context and citations?"
  };

  const prompt = {
    system:
      "You are a strict evaluator. Output JSON only with fields: correctness, completeness, groundedness, judge_score. Each field must be 0..1.",
    user: [
      `Question: ${question}`,
      `Required points: ${(benchCase.required_points || []).join(" | ")}`,
      `Expected citations: ${(benchCase.acceptable_citations || []).join(" | ")}`,
      "",
      "Rubric:",
      `- correctness: ${rubric.correctness}`,
      `- completeness: ${rubric.completeness}`,
      `- groundedness: ${rubric.groundedness}`,
      "",
      "Retrieved context:",
      buildContextText(contextBlocks),
      "",
      "Candidate answer:",
      answerText,
      "",
      "Return compact JSON only."
    ].join("\n")
  };

  const result = await callOpenAI({
    model,
    temperature,
    maxOutputTokens,
    system: prompt.system,
    user: prompt.user
  });

  const parsed = parseJudgeJson(result.text) || {};
  const correctness = clamp01(parsed.correctness);
  const completeness = clamp01(parsed.completeness);
  const groundedness = clamp01(parsed.groundedness);
  const implied = (correctness + completeness + groundedness) / 3;
  const judgeScore = clamp01(parsed.judge_score ?? implied);

  return {
    judge_score: Number(judgeScore.toFixed(4)),
    provider,
    model,
    raw: parsed,
    usage: result.usage
  };
}

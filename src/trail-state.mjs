import fs from "node:fs";
import path from "node:path";
import { hashText } from "./utils.mjs";

function trailsDir(rootDir = process.cwd()) {
  return path.resolve(rootDir, ".trail-docs", "trails");
}

function trailFilePath(trailId, rootDir = process.cwd()) {
  return path.join(trailsDir(rootDir), `${trailId}.json`);
}

function ensureTrailDir(rootDir = process.cwd()) {
  fs.mkdirSync(trailsDir(rootDir), { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function defaultTrailId(objective = "") {
  const seed = `${objective}|${Date.now()}|${Math.random()}`;
  return `trail_${hashText(seed).slice(0, 10)}`;
}

function atomicWrite(filePath, payload) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp`);
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function readTrail(trailId, rootDir = process.cwd()) {
  const filePath = trailFilePath(trailId, rootDir);
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function stableUnique(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

export function createTrailState({ objective, trailId = "", rootDir = process.cwd() }) {
  ensureTrailDir(rootDir);
  const id = String(trailId || "").trim() || defaultTrailId(objective);
  const filePath = trailFilePath(id, rootDir);
  const createdAt = nowIso();
  const payload = {
    trail_id: id,
    objective: String(objective || "").trim(),
    created_at: createdAt,
    updated_at: createdAt,
    visited_refs: [],
    pinned_evidence: [],
    coverage_tags: []
  };
  atomicWrite(filePath, payload);
  return payload;
}

export function showTrailState({ trailId, rootDir = process.cwd() }) {
  return readTrail(trailId, rootDir);
}

export function addTrailRef({ trailId, ref, rootDir = process.cwd() }) {
  const payload = readTrail(trailId, rootDir);
  payload.visited_refs = stableUnique([...(payload.visited_refs || []), String(ref || "").trim()]);
  payload.updated_at = nowIso();
  atomicWrite(trailFilePath(trailId, rootDir), payload);
  return payload;
}

export function pinTrailCitation({ trailId, citationId, rootDir = process.cwd() }) {
  const payload = readTrail(trailId, rootDir);
  payload.pinned_evidence = stableUnique([...(payload.pinned_evidence || []), String(citationId || "").trim()]);
  payload.updated_at = nowIso();
  atomicWrite(trailFilePath(trailId, rootDir), payload);
  return payload;
}

export function addTrailTag({ trailId, tag, rootDir = process.cwd() }) {
  const payload = readTrail(trailId, rootDir);
  payload.coverage_tags = stableUnique([...(payload.coverage_tags || []), String(tag || "").trim()]);
  payload.updated_at = nowIso();
  atomicWrite(trailFilePath(trailId, rootDir), payload);
  return payload;
}

export function trailExists({ trailId, rootDir = process.cwd() }) {
  return fs.existsSync(trailFilePath(trailId, rootDir));
}

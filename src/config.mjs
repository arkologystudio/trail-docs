import fs from "node:fs";
import path from "node:path";
import toml from "toml";

export function findConfigPath(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, "trail-docs.toml");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return "";
}

export function loadProjectConfig(startDir = process.cwd()) {
  const configPath = findConfigPath(startDir);
  if (!configPath) {
    return { path: "", config: null };
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = toml.parse(raw);
    return {
      path: configPath,
      config: parsed && typeof parsed === "object" ? parsed : null
    };
  } catch {
    return { path: configPath, config: null };
  }
}

export function applyConfigDefaults({ command, positionals, flags, config }) {
  if (!config || typeof config !== "object") {
    return { positionals, flags };
  }

  const nextFlags = { ...flags };
  const nextPositionals = [...positionals];

  if (!nextFlags.json && String(config.output || "").toLowerCase() === "json") {
    nextFlags.json = true;
  }

  if (!nextFlags.index && typeof config.index_path === "string" && config.index_path.trim()) {
    nextFlags.index = config.index_path.trim();
  }

  if (!nextFlags.path && typeof config.manifest_path === "string" && config.manifest_path.trim()) {
    nextFlags.path = config.manifest_path.trim();
  }

  if (!nextFlags.policy && config.trust && typeof config.trust.policy === "string" && config.trust.policy.trim()) {
    nextFlags.policy = config.trust.policy.trim();
  }

  if (
    !nextFlags.indexes &&
    config.federation &&
    Array.isArray(config.federation.indexes) &&
    config.federation.indexes.length > 0
  ) {
    nextFlags.indexes = config.federation.indexes.map((entry) => String(entry)).join(",");
  }

  return {
    positionals: nextPositionals,
    flags: nextFlags
  };
}

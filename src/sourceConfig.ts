import * as fs from "node:fs/promises";
import * as path from "node:path";
import { compactSourceRules, normalizeSourceRules, SourceRules } from "./filterRules";

interface SourceConfigRecord {
  name: string;
  url: string;
  enabled?: boolean;
  rules?: SourceRules;
}

interface FeedSourcesConfig {
  version: number;
  sources: SourceConfigRecord[];
}

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(PROJECT_ROOT, "config", "feed-sources.json");

function isHttpProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

function normalizeSourceUrl(sourceUrl: string): string {
  const parsed = new URL((sourceUrl ?? "").trim());
  if (!isHttpProtocol(parsed.protocol)) {
    throw new Error("http:// または https:// のURLのみ対応しています。");
  }
  return parsed.toString();
}

function defaultNameForUrl(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return "source";
  }
}

async function ensureConfigDirectory(): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
}

async function createDefaultConfigIfMissing(): Promise<void> {
  try {
    await fs.access(CONFIG_PATH);
  } catch {
    await ensureConfigDirectory();
    const initial: FeedSourcesConfig = { version: 1, sources: [] };
    await fs.writeFile(CONFIG_PATH, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
  }
}

function parseConfig(raw: string): FeedSourcesConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("feed-sources.json のJSON形式が不正です。");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("feed-sources.json の形式が不正です。");
  }
  const obj = parsed as { version?: unknown; sources?: unknown };
  if (obj.version !== 1) {
    throw new Error("feed-sources.json のversionは 1 のみ対応しています。");
  }
  if (!Array.isArray(obj.sources)) {
    throw new Error("feed-sources.json のsourcesは配列である必要があります。");
  }

  const sources: SourceConfigRecord[] = obj.sources.map((item: unknown, index: number) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`sources[${index}] の形式が不正です。`);
    }
    const row = item as {
      name?: unknown;
      url?: unknown;
      enabled?: unknown;
      rules?: unknown;
    };
    if (typeof row.name !== "string" || !row.name.trim()) {
      throw new Error(`sources[${index}].name を設定してください。`);
    }
    if (typeof row.url !== "string" || !row.url.trim()) {
      throw new Error(`sources[${index}].url を設定してください。`);
    }

    const normalizedUrl = normalizeSourceUrl(row.url);
    const enabled = typeof row.enabled === "boolean" ? row.enabled : undefined;

    let rules: SourceRules | undefined;
    if (row.rules !== undefined && row.rules !== null) {
      if (typeof row.rules !== "object") {
        throw new Error(`sources[${index}].rules の形式が不正です。`);
      }
      const compact = compactSourceRules(normalizeSourceRules(row.rules as SourceRules));
      rules = compact ?? undefined;
    }

    return {
      name: row.name.trim(),
      url: normalizedUrl,
      enabled,
      rules
    };
  });

  return {
    version: 1,
    sources
  };
}

async function readConfig(): Promise<FeedSourcesConfig> {
  await createDefaultConfigIfMissing();
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  return parseConfig(raw);
}

async function writeConfig(config: FeedSourcesConfig): Promise<void> {
  await ensureConfigDirectory();
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function urlsMatch(left: string, right: string): boolean {
  return normalizeSourceUrl(left) === normalizeSourceUrl(right);
}

export async function getRulesBySourceUrl(sourceUrl: string): Promise<SourceRules | null> {
  const targetUrl = normalizeSourceUrl(sourceUrl);
  const config = await readConfig();
  const matched = config.sources.find((source) => urlsMatch(source.url, targetUrl));
  if (!matched || !matched.rules) {
    return null;
  }
  return compactSourceRules(normalizeSourceRules(matched.rules));
}

export async function saveRulesForSourceUrl(
  sourceUrl: string,
  rulesInput: SourceRules | null | undefined
): Promise<void> {
  const targetUrl = normalizeSourceUrl(sourceUrl);
  const normalizedRules = normalizeSourceRules(rulesInput ?? undefined);
  const compactRules = compactSourceRules(normalizedRules) ?? undefined;
  const config = await readConfig();

  const index = config.sources.findIndex((source) => urlsMatch(source.url, targetUrl));
  if (index >= 0) {
    const existing = config.sources[index];
    config.sources[index] = {
      ...existing,
      url: targetUrl,
      rules: compactRules
    };
  } else {
    config.sources.push({
      name: defaultNameForUrl(targetUrl),
      url: targetUrl,
      enabled: true,
      rules: compactRules
    });
  }

  await writeConfig(config);
}

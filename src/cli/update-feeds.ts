import * as fs from "node:fs/promises";
import * as path from "node:path";
import { buildFeedPath } from "../githubPublisher";
import { extractFeed } from "../scraper";

interface SourceConfig {
  name: string;
  url: string;
  enabled?: boolean;
}

interface FeedSourcesConfig {
  version: number;
  sources: SourceConfig[];
}

interface FailedSource {
  name: string;
  url: string;
  path: string;
  error: string;
}

interface ManagedFeedsMeta {
  generatedAt: string;
  desiredPaths: string[];
  successfulPaths: string[];
  failedSources: FailedSource[];
}

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const CONFIG_PATH = path.join(PROJECT_ROOT, "config", "feed-sources.json");
const OUTPUT_ROOT = path.join(PROJECT_ROOT, ".generated-feeds");
const META_PATH = path.join(OUTPUT_ROOT, "managed-feeds.json");

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeText(value: string | undefined | null): string {
  return (value ?? "").trim();
}

async function readSourcesConfig(): Promise<FeedSourcesConfig> {
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`設定ファイルのJSON形式が不正です: ${CONFIG_PATH}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("設定ファイルの形式が不正です。");
  }

  const obj = parsed as { version?: unknown; sources?: unknown };
  if (obj.version !== 1) {
    throw new Error("設定ファイルversionは 1 のみ対応しています。");
  }
  if (!Array.isArray(obj.sources)) {
    throw new Error("設定ファイルsourcesは配列である必要があります。");
  }

  const sources: SourceConfig[] = obj.sources.map((item: unknown, index: number) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`sources[${index}] の形式が不正です。`);
    }
    const row = item as { name?: unknown; url?: unknown; enabled?: unknown };
    const name = normalizeText(typeof row.name === "string" ? row.name : "");
    const url = normalizeText(typeof row.url === "string" ? row.url : "");
    const enabled = typeof row.enabled === "boolean" ? row.enabled : undefined;

    if (!name) {
      throw new Error(`sources[${index}].name を設定してください。`);
    }
    if (!url || !isHttpUrl(url)) {
      throw new Error(`sources[${index}].url は http/https のURLを指定してください。`);
    }

    return { name, url, enabled };
  });

  return {
    version: 1,
    sources
  };
}

async function prepareOutputDirectory(): Promise<void> {
  await fs.rm(OUTPUT_ROOT, { recursive: true, force: true });
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
}

function ensureUniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths)).sort((a, b) => a.localeCompare(b));
}

async function writeMeta(meta: ManagedFeedsMeta): Promise<void> {
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf8");
}

async function run(): Promise<void> {
  const config = await readSourcesConfig();
  const enabledSources = config.sources.filter((source) => source.enabled !== false);
  if (enabledSources.length === 0) {
    throw new Error("有効な更新対象URLがありません。config/feed-sources.json を確認してください。");
  }

  await prepareOutputDirectory();

  const desiredPaths: string[] = [];
  const successfulPaths: string[] = [];
  const failedSources: FailedSource[] = [];

  for (const source of enabledSources) {
    const relativePath = buildFeedPath(source.url);
    desiredPaths.push(relativePath);

    process.stdout.write(`[update-feeds] extracting: ${source.name} (${source.url})\n`);

    try {
      const result = await extractFeed(source.url);
      if (!result.rssXml || !result.rssXml.trim()) {
        throw new Error("抽出結果のRSS XMLが空でした。");
      }

      const outputPath = path.join(OUTPUT_ROOT, ...relativePath.split("/"));
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, result.rssXml, "utf8");
      successfulPaths.push(relativePath);

      process.stdout.write(`[update-feeds] success: ${relativePath}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "不明なエラー";
      failedSources.push({
        name: source.name,
        url: source.url,
        path: relativePath,
        error: message
      });
      process.stdout.write(`[update-feeds] failed: ${source.name} -> ${message}\n`);
    }
  }

  const meta: ManagedFeedsMeta = {
    generatedAt: new Date().toISOString(),
    desiredPaths: ensureUniquePaths(desiredPaths),
    successfulPaths: ensureUniquePaths(successfulPaths),
    failedSources
  };
  await writeMeta(meta);

  process.stdout.write(
    `[update-feeds] summary: success=${meta.successfulPaths.length}, failed=${meta.failedSources.length}\n`
  );

  if (meta.successfulPaths.length === 0) {
    throw new Error("すべてのURLでRSS生成に失敗しました。");
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "不明なエラー";
  process.stderr.write(`[update-feeds] error: ${message}\n`);
  process.exit(1);
});

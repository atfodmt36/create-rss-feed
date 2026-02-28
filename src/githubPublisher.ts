import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { promisify } from "node:util";

export const PAGES_BRANCH = "gh-pages" as const;

interface RepoParts {
  owner: string;
  repo: string;
}

export interface GithubConfig {
  repo: string;
  branch: typeof PAGES_BRANCH;
}

export interface PublishFeedInput {
  sourceUrl: string;
  rssXml: string;
  feedTitle: string;
  token: string;
}

export interface PublishFeedResult {
  repo: string;
  path: string;
  publishedUrl: string;
  commitSha: string;
}

type OctokitInstance = any;

const execFileAsync = promisify(execFile);

function parseRepoFromOwnerRepo(ownerRepo: string): RepoParts | null {
  const normalized = ownerRepo.trim().replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/");
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    return null;
  }
  return { owner: segments[0], repo: segments[1] };
}

function parseRepoFromRemote(remoteUrl: string): RepoParts | null {
  const normalized = remoteUrl.trim();
  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i
  ];

  for (const pattern of patterns) {
    const matched = normalized.match(pattern);
    if (matched && matched[1] && matched[2]) {
      return { owner: matched[1], repo: matched[2] };
    }
  }
  return null;
}

async function getOriginRemoteUrl(): Promise<string | null> {
  const candidates = Array.from(
    new Set<string>([
      process.cwd(),
      path.resolve(process.cwd(), ".."),
      path.resolve(__dirname, ".."),
      path.resolve(__dirname, "../..")
    ])
  );

  for (const cwd of candidates) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["config", "--get", "remote.origin.url"],
        {
          cwd,
          windowsHide: true
        }
      );
      const remote = stdout.trim();
      if (remote) {
        return remote;
      }
    } catch {
      // 次の候補ディレクトリを試す。
    }
  }

  return null;
}

function resolveRepoFromEnv(): RepoParts | null {
  const fromCreateRssFeed = process.env.CREATE_RSS_FEED_REPOSITORY;
  if (fromCreateRssFeed) {
    return parseRepoFromOwnerRepo(fromCreateRssFeed);
  }
  const fromGithubRepository = process.env.GITHUB_REPOSITORY;
  if (fromGithubRepository) {
    return parseRepoFromOwnerRepo(fromGithubRepository);
  }
  return null;
}

async function resolveRepoParts(): Promise<RepoParts> {
  const envResolved = resolveRepoFromEnv();
  if (envResolved) {
    return envResolved;
  }

  const remoteUrl = await getOriginRemoteUrl();
  if (!remoteUrl) {
    throw new Error(
      "GitHubリポジトリ情報を取得できません。環境変数 CREATE_RSS_FEED_REPOSITORY を owner/repo 形式で設定してください。"
    );
  }

  const remoteResolved = parseRepoFromRemote(remoteUrl);
  if (!remoteResolved) {
    throw new Error(
      "origin が GitHub リポジトリではありません。CREATE_RSS_FEED_REPOSITORY を owner/repo 形式で指定してください。"
    );
  }

  return remoteResolved;
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function sanitizePathSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

export function buildFeedPath(sourceUrl: string): string {
  const parsed = new URL(sourceUrl);
  const host = sanitizePathSegment(parsed.hostname);
  const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 16);
  return `feeds/${host}/${hash}.xml`;
}

function buildDefaultPagesBaseUrl(owner: string, repo: string): string {
  if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return `https://${owner}.github.io/`;
  }
  return `https://${owner}.github.io/${encodeURIComponent(repo)}/`;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

async function resolvePagesBaseUrl(octokit: OctokitInstance, repo: RepoParts): Promise<string> {
  try {
    const pageInfo = await octokit.repos.getPages({
      owner: repo.owner,
      repo: repo.repo
    });
    const htmlUrl = (pageInfo.data?.html_url ?? "").trim();
    if (htmlUrl) {
      return ensureTrailingSlash(htmlUrl);
    }
  } catch {
    // Pages APIの権限がないトークンでも公開処理は継続できるよう既定URLへフォールバックする。
  }

  return buildDefaultPagesBaseUrl(repo.owner, repo.repo);
}

function buildPublishedUrl(baseUrl: string, filePath: string): string {
  const safePath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(safePath, ensureTrailingSlash(baseUrl)).toString();
}

async function createOctokit(token: string): Promise<OctokitInstance> {
  try {
    // CommonJS環境でもESMパッケージを読み込めるように実行時importを使う。
    const runtimeImport = new Function(
      "specifier",
      "return import(specifier);"
    ) as (specifier: string) => Promise<any>;
    const octokitLib = (await runtimeImport("@octokit/rest")) as {
      Octokit?: new (options: { auth: string }) => OctokitInstance;
      default?: { Octokit?: new (options: { auth: string }) => OctokitInstance };
    };
    const OctokitCtor = octokitLib.Octokit ?? octokitLib.default?.Octokit;
    if (typeof OctokitCtor !== "function") {
      throw new Error("Octokit コンストラクタを取得できません。");
    }
    return new OctokitCtor({ auth: token });
  } catch {
    throw new Error("@octokit/rest が読み込めません。依存関係をインストールしてください。");
  }
}

async function ensureGhPagesBranch(octokit: OctokitInstance, repo: RepoParts): Promise<void> {
  try {
    await octokit.git.getRef({
      owner: repo.owner,
      repo: repo.repo,
      ref: `heads/${PAGES_BRANCH}`
    });
    return;
  } catch (error) {
    if (getErrorStatus(error) !== 404) {
      throw error;
    }
  }

  const repoInfo = await octokit.repos.get({
    owner: repo.owner,
    repo: repo.repo
  });
  const defaultBranch = repoInfo.data.default_branch || "main";
  const defaultRef = await octokit.git.getRef({
    owner: repo.owner,
    repo: repo.repo,
    ref: `heads/${defaultBranch}`
  });

  await octokit.git.createRef({
    owner: repo.owner,
    repo: repo.repo,
    ref: `refs/heads/${PAGES_BRANCH}`,
    sha: defaultRef.data.object.sha
  });
}

async function getExistingFileSha(
  octokit: OctokitInstance,
  repo: RepoParts,
  filePath: string
): Promise<string | undefined> {
  try {
    const content = await octokit.repos.getContent({
      owner: repo.owner,
      repo: repo.repo,
      path: filePath,
      ref: PAGES_BRANCH
    });
    if (Array.isArray(content.data)) {
      return undefined;
    }
    return typeof content.data.sha === "string" ? content.data.sha : undefined;
  } catch (error) {
    if (getErrorStatus(error) === 404) {
      return undefined;
    }
    throw error;
  }
}

function normalizeToken(token: string): string {
  return (token ?? "").trim();
}

function normalizeCommitTitle(feedTitle: string, sourceUrl: string): string {
  const raw = (feedTitle ?? "").trim() || sourceUrl;
  return raw.length > 80 ? `${raw.slice(0, 80)}...` : raw;
}

export async function getGithubConfig(): Promise<GithubConfig> {
  const repo = await resolveRepoParts();
  return {
    repo: `${repo.owner}/${repo.repo}`,
    branch: PAGES_BRANCH
  };
}

export async function publishFeedToGitHubPages(
  input: PublishFeedInput
): Promise<PublishFeedResult> {
  const token = normalizeToken(input.token);
  if (!token) {
    throw new Error("GitHubトークンが設定されていません。");
  }
  if (!input.rssXml || !input.rssXml.trim()) {
    throw new Error("公開するRSS XMLが空です。");
  }

  const repo = await resolveRepoParts();
  const octokit = await createOctokit(token);
  await ensureGhPagesBranch(octokit, repo);
  const pagesBaseUrl = await resolvePagesBaseUrl(octokit, repo);

  const filePath = buildFeedPath(input.sourceUrl);
  const existingSha = await getExistingFileSha(octokit, repo, filePath);
  const content = Buffer.from(input.rssXml, "utf8").toString("base64");
  const commitMessage = `chore(feed): update ${normalizeCommitTitle(
    input.feedTitle,
    input.sourceUrl
  )}`;

  const updateResponse = await octokit.repos.createOrUpdateFileContents({
    owner: repo.owner,
    repo: repo.repo,
    branch: PAGES_BRANCH,
    path: filePath,
    message: commitMessage,
    content,
    sha: existingSha
  });

  return {
    repo: `${repo.owner}/${repo.repo}`,
    path: filePath,
    publishedUrl: buildPublishedUrl(pagesBaseUrl, filePath),
    commitSha: updateResponse.data.commit.sha
  };
}

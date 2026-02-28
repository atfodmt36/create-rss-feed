import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { hasGithubToken, loadGithubToken, saveGithubToken } from "./credentials";
import {
  getGithubConfig,
  publishFeedToGitHubPages,
  PublishFeedResult
} from "./githubPublisher";
import { SourceRules } from "./filterRules";
import { extractFeed, FeedResult } from "./scraper";
import { getRulesBySourceUrl, saveRulesForSourceUrl } from "./sourceConfig";

type GenerateFeedIpcResponse =
  | { success: true; data: FeedResult }
  | { success: false; error: string };

type SaveFileIpcResponse =
  | { success: true; filePath: string }
  | { success: false; canceled?: boolean; error?: string };

type SetGithubTokenIpcResponse = { success: true } | { success: false; error: string };

type GetGithubConfigIpcResponse =
  | { success: true; repo: string; branch: "gh-pages"; tokenConfigured: boolean }
  | { success: false; error: string };

type PublishFeedIpcResponse =
  | {
      success: true;
      publishedUrl: string;
      path: string;
      commitSha: string;
      repo: string;
    }
  | { success: false; error: string };

type PublishFeedIpcPayload = {
  sourceUrl: string;
  rssXml: string;
  feedTitle: string;
};

type SaveSourceRulesIpcPayload = {
  sourceUrl: string;
  rules: SourceRules | null;
};

type SaveSourceRulesIpcResponse = { success: true } | { success: false; error: string };

type GetSourceRulesIpcResponse =
  | { success: true; rules: SourceRules | null }
  | { success: false; error: string };

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 920,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

ipcMain.handle("generate-feed", async (_event, url: string): Promise<GenerateFeedIpcResponse> => {
  const normalizedUrl = (url ?? "").trim();
  if (!normalizedUrl) {
    return { success: false, error: "URLを入力してください。" };
  }
  if (!isValidHttpUrl(normalizedUrl)) {
    return {
      success: false,
      error: "URL形式が不正です。http:// または https:// のURLを指定してください。"
    };
  }

  try {
    const rules = await getRulesBySourceUrl(normalizedUrl);
    const feedResult = await extractFeed(normalizedUrl, { rules });
    if (feedResult.articles.length === 0) {
      return { success: false, error: "記事を抽出できませんでした。" };
    }
    return { success: true, data: feedResult };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "フィード生成中に不明なエラーが発生しました。";
    return { success: false, error: message };
  }
});

ipcMain.handle("save-file", async (_event, xmlContent: string): Promise<SaveFileIpcResponse> => {
  if (!xmlContent || typeof xmlContent !== "string") {
    return { success: false, error: "保存するXMLが空です。" };
  }

  const result = await dialog.showSaveDialog({
    title: "RSSファイルを保存",
    defaultPath: "generated-feed.xml",
    filters: [{ name: "RSS XML", extensions: ["xml"] }]
  });

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }

  try {
    await fs.writeFile(result.filePath, xmlContent, "utf8");
    return { success: true, filePath: result.filePath };
  } catch (error) {
    return { success: false, error: toErrorMessage(error, "ファイル保存中にエラーが発生しました。") };
  }
});

ipcMain.handle(
  "set-github-token",
  async (_event, token: string): Promise<SetGithubTokenIpcResponse> => {
    const normalized = (token ?? "").trim();
    if (!normalized) {
      return { success: false, error: "GitHubトークンを入力してください。" };
    }
    if (normalized.length < 20) {
      return { success: false, error: "GitHubトークンの形式が不正です。" };
    }

    try {
      await saveGithubToken(normalized);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: toErrorMessage(
          error,
          "トークンの保存に失敗しました。OS資格情報ストアが利用可能か確認してください。"
        )
      };
    }
  }
);

ipcMain.handle(
  "save-source-rules",
  async (_event, payload: SaveSourceRulesIpcPayload): Promise<SaveSourceRulesIpcResponse> => {
    const sourceUrl = (payload?.sourceUrl ?? "").trim();
    if (!sourceUrl || !isValidHttpUrl(sourceUrl)) {
      return { success: false, error: "ルール保存対象URLが不正です。" };
    }

    try {
      await saveRulesForSourceUrl(sourceUrl, payload?.rules ?? null);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: toErrorMessage(error, "抽出ルールの保存に失敗しました。")
      };
    }
  }
);

ipcMain.handle(
  "get-source-rules",
  async (_event, sourceUrl: string): Promise<GetSourceRulesIpcResponse> => {
    const normalizedUrl = (sourceUrl ?? "").trim();
    if (!normalizedUrl || !isValidHttpUrl(normalizedUrl)) {
      return { success: false, error: "ルール取得対象URLが不正です。" };
    }

    try {
      const rules = await getRulesBySourceUrl(normalizedUrl);
      return { success: true, rules };
    } catch (error) {
      return {
        success: false,
        error: toErrorMessage(error, "抽出ルールの取得に失敗しました。")
      };
    }
  }
);

ipcMain.handle("get-github-config", async (): Promise<GetGithubConfigIpcResponse> => {
  try {
    const [config, tokenConfigured] = await Promise.all([getGithubConfig(), hasGithubToken()]);
    return {
      success: true,
      repo: config.repo,
      branch: config.branch,
      tokenConfigured
    };
  } catch (error) {
    return {
      success: false,
      error: toErrorMessage(
        error,
        "GitHubリポジトリ設定を取得できませんでした。origin または環境変数設定を確認してください。"
      )
    };
  }
});

ipcMain.handle(
  "publish-feed",
  async (_event, payload: PublishFeedIpcPayload): Promise<PublishFeedIpcResponse> => {
    const sourceUrl = (payload?.sourceUrl ?? "").trim();
    if (!sourceUrl || !isValidHttpUrl(sourceUrl)) {
      return { success: false, error: "公開対象URLが不正です。" };
    }
    const rssXml = payload?.rssXml ?? "";
    if (!rssXml.trim()) {
      return { success: false, error: "公開するRSS XMLが空です。" };
    }

    try {
      const token = await loadGithubToken();
      if (!token) {
        return { success: false, error: "GitHubトークンが未設定です。" };
      }
      const result: PublishFeedResult = await publishFeedToGitHubPages({
        sourceUrl,
        rssXml,
        feedTitle: (payload?.feedTitle ?? "").trim(),
        token
      });
      return {
        success: true,
        publishedUrl: result.publishedUrl,
        path: result.path,
        commitSha: result.commitSha,
        repo: result.repo
      };
    } catch (error) {
      return {
        success: false,
        error: toErrorMessage(error, "GitHub Pagesへの公開に失敗しました。")
      };
    }
  }
);

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

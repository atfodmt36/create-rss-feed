const urlInput = document.getElementById("urlInput");
const generateButton = document.getElementById("generateButton");
const statusMessage = document.getElementById("statusMessage");
const resultSection = document.getElementById("resultSection");
const feedTitle = document.getElementById("feedTitle");
const feedDescription = document.getElementById("feedDescription");
const countBadge = document.getElementById("countBadge");
const methodBadge = document.getElementById("methodBadge");
const articlesList = document.getElementById("articlesList");
const copyXmlButton = document.getElementById("copyXmlButton");
const saveXmlButton = document.getElementById("saveXmlButton");
const githubConfigText = document.getElementById("githubConfigText");
const githubTokenInput = document.getElementById("githubTokenInput");
const saveTokenButton = document.getElementById("saveTokenButton");
const publishButton = document.getElementById("publishButton");
const copyPublishedUrlButton = document.getElementById("copyPublishedUrlButton");
const publishedUrlText = document.getElementById("publishedUrlText");
const publishResultText = document.getElementById("publishResultText");

let latestResult = null;
let latestPublishedUrl = "";
let publishInProgress = false;
let githubState = {
  available: false,
  repo: "",
  branch: "",
  tokenConfigured: false
};

function escapeHtml(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(type, message) {
  statusMessage.className = `status ${type}`;
  statusMessage.textContent = message;
}

function getElectronApi() {
  return window.electronAPI;
}

function formatDate(value) {
  if (!value) {
    return "日付不明";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "日付不明";
  }
  return parsed.toLocaleString("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function validateUrl(input) {
  if (!input) {
    return "URLを入力してください。";
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return "URL形式が不正です。";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "http:// または https:// のURLのみ対応しています。";
  }
  return null;
}

function getMethodLabel(method) {
  return method === "rss-auto-detect" ? "RSS自動検出" : "ヒューリスティック抽出";
}

function updatePublishButtonState() {
  const canPublish =
    !publishInProgress &&
    githubState.available &&
    githubState.tokenConfigured &&
    latestResult &&
    latestResult.rssXml;
  publishButton.disabled = !canPublish;
}

function clearPublishedInfo() {
  latestPublishedUrl = "";
  publishedUrlText.textContent = "公開URL: -";
  publishResultText.textContent = "コミット情報: -";
  copyPublishedUrlButton.disabled = true;
}

function renderGithubConfig() {
  if (!githubState.available) {
    githubConfigText.textContent =
      "GitHubリポジトリ情報を取得できません。origin または環境変数 CREATE_RSS_FEED_REPOSITORY を確認してください。";
    updatePublishButtonState();
    return;
  }

  const tokenLabel = githubState.tokenConfigured ? "トークン設定済み" : "トークン未設定";
  githubConfigText.textContent = `連携先: ${githubState.repo} (${githubState.branch}) | ${tokenLabel}`;
  updatePublishButtonState();
}

async function refreshGithubConfig() {
  const api = getElectronApi();
  if (!api || typeof api.getGithubConfig !== "function") {
    githubState = { available: false, repo: "", branch: "", tokenConfigured: false };
    renderGithubConfig();
    return;
  }

  try {
    const response = await api.getGithubConfig();
    if (!response || response.success !== true) {
      githubState = { available: false, repo: "", branch: "", tokenConfigured: false };
      renderGithubConfig();
      return;
    }
    githubState = {
      available: true,
      repo: response.repo,
      branch: response.branch,
      tokenConfigured: response.tokenConfigured
    };
    renderGithubConfig();
  } catch {
    githubState = { available: false, repo: "", branch: "", tokenConfigured: false };
    renderGithubConfig();
  }
}

function renderArticles(articles) {
  if (!Array.isArray(articles) || articles.length === 0) {
    articlesList.innerHTML = '<li class="empty">記事を抽出できませんでした。</li>';
    return;
  }

  const items = articles
    .map((article) => {
      const title = escapeHtml(article.title || "(タイトルなし)");
      const url = escapeHtml(article.url || "");
      const description = escapeHtml(article.description || "");
      const author = escapeHtml(article.author || "不明");
      const date = escapeHtml(formatDate(article.publishedAt));

      return `
        <li class="article-item">
          <h3><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
          <p class="meta">公開日: ${date} | 著者: ${author}</p>
          <p class="url">${url}</p>
          <p class="description">${description || "説明なし"}</p>
        </li>
      `;
    })
    .join("");

  articlesList.innerHTML = items;
}

function renderResult(result) {
  feedTitle.textContent = result.feedTitle || "タイトルなし";
  feedDescription.textContent = result.feedDescription || "説明なし";
  countBadge.textContent = `${result.articles.length}件`;
  methodBadge.textContent = getMethodLabel(result.method);
  renderArticles(result.articles);
  resultSection.classList.remove("hidden");
}

async function onGenerateClick() {
  const targetUrl = urlInput.value.trim();
  const validationError = validateUrl(targetUrl);
  if (validationError) {
    setStatus("error", validationError);
    return;
  }

  const api = getElectronApi();
  if (!api || typeof api.generateFeed !== "function") {
    setStatus("error", "Electron APIの初期化に失敗しました。");
    return;
  }

  generateButton.disabled = true;
  setStatus("loading", "フィードを生成しています...");

  try {
    const response = await api.generateFeed(targetUrl);
    if (!response || response.success !== true) {
      const errorMessage = response && response.error ? response.error : "フィード生成に失敗しました。";
      setStatus("error", errorMessage);
      clearPublishedInfo();
      updatePublishButtonState();
      return;
    }
    latestResult = response.data;
    clearPublishedInfo();
    renderResult(latestResult);
    setStatus("success", `${latestResult.articles.length}件の記事を抽出しました。`);
    updatePublishButtonState();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    setStatus("error", errorMessage);
    clearPublishedInfo();
    updatePublishButtonState();
  } finally {
    generateButton.disabled = false;
  }
}

async function onCopyXmlClick() {
  if (!latestResult || !latestResult.rssXml) {
    setStatus("error", "先にフィードを生成してください。");
    return;
  }

  try {
    await navigator.clipboard.writeText(latestResult.rssXml);
    setStatus("success", "XMLをクリップボードにコピーしました。");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "コピーに失敗しました。";
    setStatus("error", errorMessage);
  }
}

async function onSaveXmlClick() {
  if (!latestResult || !latestResult.rssXml) {
    setStatus("error", "先にフィードを生成してください。");
    return;
  }

  const api = getElectronApi();
  if (!api || typeof api.saveFile !== "function") {
    setStatus("error", "保存APIが利用できません。");
    return;
  }

  try {
    const response = await api.saveFile(latestResult.rssXml);
    if (response && response.success) {
      setStatus("success", "RSSファイルを保存しました。");
      return;
    }
    if (response && response.canceled) {
      setStatus("info", "保存をキャンセルしました。");
      return;
    }
    const errorMessage = response && response.error ? response.error : "保存に失敗しました。";
    setStatus("error", errorMessage);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "保存中にエラーが発生しました。";
    setStatus("error", errorMessage);
  }
}

async function onSaveTokenClick() {
  const token = githubTokenInput.value.trim();
  if (!token) {
    setStatus("error", "GitHubトークンを入力してください。");
    return;
  }

  const api = getElectronApi();
  if (!api || typeof api.setGithubToken !== "function") {
    setStatus("error", "トークン保存APIが利用できません。");
    return;
  }

  saveTokenButton.disabled = true;
  setStatus("loading", "GitHubトークンを保存しています...");

  try {
    const response = await api.setGithubToken(token);
    if (!response || response.success !== true) {
      const errorMessage = response && response.error ? response.error : "トークン保存に失敗しました。";
      setStatus("error", errorMessage);
      return;
    }
    githubTokenInput.value = "";
    await refreshGithubConfig();
    setStatus("success", "GitHubトークンを保存しました。");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "トークン保存中にエラーが発生しました。";
    setStatus("error", errorMessage);
  } finally {
    saveTokenButton.disabled = false;
  }
}

function shortenSha(sha) {
  if (typeof sha !== "string" || sha.length < 7) {
    return sha || "-";
  }
  return sha.slice(0, 7);
}

async function onPublishClick() {
  if (!latestResult || !latestResult.rssXml) {
    setStatus("error", "先にフィードを生成してください。");
    return;
  }
  if (!githubState.available) {
    setStatus("error", "GitHubリポジトリ情報が取得できないため公開できません。");
    return;
  }
  if (!githubState.tokenConfigured) {
    setStatus("error", "先にGitHubトークンを登録してください。");
    return;
  }

  const api = getElectronApi();
  if (!api || typeof api.publishFeed !== "function") {
    setStatus("error", "公開APIが利用できません。");
    return;
  }

  publishInProgress = true;
  updatePublishButtonState();
  setStatus("loading", "GitHub Pagesへ公開しています...");

  try {
    const response = await api.publishFeed({
      sourceUrl: latestResult.sourceUrl,
      rssXml: latestResult.rssXml,
      feedTitle: latestResult.feedTitle
    });

    if (!response || response.success !== true) {
      const errorMessage = response && response.error ? response.error : "公開に失敗しました。";
      setStatus("error", errorMessage);
      return;
    }

    latestPublishedUrl = response.publishedUrl;
    publishedUrlText.textContent = `公開URL: ${response.publishedUrl}`;
    publishResultText.textContent = `コミット: ${shortenSha(response.commitSha)} | パス: ${response.path}`;
    copyPublishedUrlButton.disabled = false;
    setStatus("success", "GitHub Pagesへ公開しました。Power AutomateでURLを監視できます。");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "公開中にエラーが発生しました。";
    setStatus("error", errorMessage);
  } finally {
    publishInProgress = false;
    updatePublishButtonState();
  }
}

async function onCopyPublishedUrlClick() {
  if (!latestPublishedUrl) {
    setStatus("error", "公開URLがありません。先に公開してください。");
    return;
  }
  try {
    await navigator.clipboard.writeText(latestPublishedUrl);
    setStatus("success", "公開URLをコピーしました。");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "URLコピーに失敗しました。";
    setStatus("error", errorMessage);
  }
}

generateButton.addEventListener("click", onGenerateClick);
urlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    onGenerateClick();
  }
});
copyXmlButton.addEventListener("click", onCopyXmlClick);
saveXmlButton.addEventListener("click", onSaveXmlClick);
saveTokenButton.addEventListener("click", onSaveTokenClick);
publishButton.addEventListener("click", onPublishClick);
copyPublishedUrlButton.addEventListener("click", onCopyPublishedUrlClick);

refreshGithubConfig();

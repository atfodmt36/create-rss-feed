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
const titleIncludesInput = document.getElementById("titleIncludesInput");
const titleExcludesInput = document.getElementById("titleExcludesInput");
const urlIncludesInput = document.getElementById("urlIncludesInput");
const urlExcludesInput = document.getElementById("urlExcludesInput");
const descriptionRequiredInput = document.getElementById("descriptionRequiredInput");
const publishedAtRequiredInput = document.getElementById("publishedAtRequiredInput");
const skipTopCountInput = document.getElementById("skipTopCountInput");
const saveRulesButton = document.getElementById("saveRulesButton");
const regenerateWithRulesButton = document.getElementById("regenerateWithRulesButton");
const rulesStatusText = document.getElementById("rulesStatusText");

let latestResult = null;
let latestPublishedUrl = "";
let publishInProgress = false;
let githubState = {
  available: false,
  repo: "",
  branch: "",
  tokenConfigured: false
};

function getElectronApi() {
  return window.electronAPI;
}

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

function setRulesActionsEnabled(enabled) {
  saveRulesButton.disabled = !enabled;
  regenerateWithRulesButton.disabled = !enabled;
}

function clearPublishedInfo() {
  latestPublishedUrl = "";
  publishedUrlText.textContent = "公開URL: -";
  publishResultText.textContent = "コミット情報: -";
  copyPublishedUrlButton.disabled = true;
}

function clearRuleForm() {
  titleIncludesInput.value = "";
  titleExcludesInput.value = "";
  urlIncludesInput.value = "";
  urlExcludesInput.value = "";
  descriptionRequiredInput.checked = false;
  publishedAtRequiredInput.checked = false;
  skipTopCountInput.value = "0";
}

function normalizeLinesFromText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readRulesFromForm() {
  const skipRaw = Number(skipTopCountInput.value);
  const safeSkip = Number.isFinite(skipRaw) ? Math.max(0, Math.floor(skipRaw)) : 0;

  const rules = {};
  const titleIncludes = normalizeLinesFromText(titleIncludesInput.value);
  const titleExcludes = normalizeLinesFromText(titleExcludesInput.value);
  const urlIncludes = normalizeLinesFromText(urlIncludesInput.value);
  const urlExcludes = normalizeLinesFromText(urlExcludesInput.value);

  if (titleIncludes.length > 0) {
    rules.titleIncludes = titleIncludes;
  }
  if (titleExcludes.length > 0) {
    rules.titleExcludes = titleExcludes;
  }
  if (urlIncludes.length > 0) {
    rules.urlIncludes = urlIncludes;
  }
  if (urlExcludes.length > 0) {
    rules.urlExcludes = urlExcludes;
  }
  if (descriptionRequiredInput.checked) {
    rules.descriptionRequired = true;
  }
  if (publishedAtRequiredInput.checked) {
    rules.publishedAtRequired = true;
  }
  if (safeSkip > 0) {
    rules.skipTopCount = safeSkip;
  }

  return rules;
}

function fillRulesForm(rules) {
  const source = rules && typeof rules === "object" ? rules : {};
  titleIncludesInput.value = Array.isArray(source.titleIncludes)
    ? source.titleIncludes.join("\n")
    : "";
  titleExcludesInput.value = Array.isArray(source.titleExcludes)
    ? source.titleExcludes.join("\n")
    : "";
  urlIncludesInput.value = Array.isArray(source.urlIncludes)
    ? source.urlIncludes.join("\n")
    : "";
  urlExcludesInput.value = Array.isArray(source.urlExcludes)
    ? source.urlExcludes.join("\n")
    : "";
  descriptionRequiredInput.checked = source.descriptionRequired === true;
  publishedAtRequiredInput.checked = source.publishedAtRequired === true;
  skipTopCountInput.value =
    typeof source.skipTopCount === "number" && source.skipTopCount > 0
      ? String(Math.floor(source.skipTopCount))
      : "0";
}

function formatRulesSummary(rules) {
  if (!rules || typeof rules !== "object") {
    return "未設定";
  }
  const parts = [];
  if (Array.isArray(rules.titleIncludes) && rules.titleIncludes.length > 0) {
    parts.push(`タイトル含む:${rules.titleIncludes.length}`);
  }
  if (Array.isArray(rules.titleExcludes) && rules.titleExcludes.length > 0) {
    parts.push(`タイトル除外:${rules.titleExcludes.length}`);
  }
  if (Array.isArray(rules.urlIncludes) && rules.urlIncludes.length > 0) {
    parts.push(`URL含む:${rules.urlIncludes.length}`);
  }
  if (Array.isArray(rules.urlExcludes) && rules.urlExcludes.length > 0) {
    parts.push(`URL除外:${rules.urlExcludes.length}`);
  }
  if (rules.descriptionRequired === true) {
    parts.push("description必須");
  }
  if (rules.publishedAtRequired === true) {
    parts.push("日時必須");
  }
  if (typeof rules.skipTopCount === "number" && rules.skipTopCount > 0) {
    parts.push(`先頭除外:${Math.floor(rules.skipTopCount)}件`);
  }
  return parts.length > 0 ? parts.join(" / ") : "未設定";
}

function setRulesStatus(message) {
  rulesStatusText.textContent = `ルール状態: ${message}`;
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

function updateRulesSummaryFromResult(result) {
  if (!result) {
    setRulesStatus("未設定");
    return;
  }
  const filteredOutCount = Number.isFinite(result.filteredOutCount)
    ? result.filteredOutCount
    : 0;
  const skippedTopCount = Number.isFinite(result.skippedTopCount) ? result.skippedTopCount : 0;
  const ruleFilteredCount = Number.isFinite(result.ruleFilteredCount)
    ? result.ruleFilteredCount
    : 0;

  const stats =
    filteredOutCount > 0
      ? `除外 ${filteredOutCount}件（先頭 ${skippedTopCount}件 / 条件 ${ruleFilteredCount}件）`
      : "除外 0件";
  const summary = formatRulesSummary(result.appliedRules);
  setRulesStatus(`${stats} | ${summary}`);
}

function renderResult(result) {
  feedTitle.textContent = result.feedTitle || "タイトルなし";
  feedDescription.textContent = result.feedDescription || "説明なし";
  const originalCount = Number.isFinite(result.originalArticleCount)
    ? result.originalArticleCount
    : result.articles.length;
  countBadge.textContent =
    originalCount === result.articles.length
      ? `${result.articles.length}件`
      : `${result.articles.length}/${originalCount}件`;
  methodBadge.textContent = getMethodLabel(result.method);
  renderArticles(result.articles);
  resultSection.classList.remove("hidden");
  updateRulesSummaryFromResult(result);
}

async function loadRulesForSource(sourceUrl) {
  const api = getElectronApi();
  if (!api || typeof api.getSourceRules !== "function") {
    clearRuleForm();
    setRulesStatus("この環境ではルール機能を利用できません");
    return;
  }

  try {
    const response = await api.getSourceRules(sourceUrl);
    if (!response || response.success !== true) {
      clearRuleForm();
      setRulesStatus("ルール取得に失敗しました");
      return;
    }
    fillRulesForm(response.rules);
    if (response.rules) {
      setRulesStatus(`保存済み: ${formatRulesSummary(response.rules)}`);
    } else {
      setRulesStatus("未設定");
    }
  } catch {
    clearRuleForm();
    setRulesStatus("ルール取得に失敗しました");
  }
}

async function saveRulesForCurrentSource(quiet) {
  if (!latestResult || !latestResult.sourceUrl) {
    setStatus("error", "先にフィードを生成してください。");
    return false;
  }

  const api = getElectronApi();
  if (!api || typeof api.saveSourceRules !== "function") {
    setStatus("error", "ルール保存APIが利用できません。");
    return false;
  }

  const rules = readRulesFromForm();
  saveRulesButton.disabled = true;
  if (!quiet) {
    setStatus("loading", "抽出ルールを保存しています...");
  }

  try {
    const response = await api.saveSourceRules({
      sourceUrl: latestResult.sourceUrl,
      rules
    });
    if (!response || response.success !== true) {
      const errorMessage = response && response.error ? response.error : "ルール保存に失敗しました。";
      setStatus("error", errorMessage);
      return false;
    }
    await loadRulesForSource(latestResult.sourceUrl);
    if (!quiet) {
      setStatus("success", "抽出ルールを保存しました。");
    }
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "ルール保存中にエラーが発生しました。";
    setStatus("error", errorMessage);
    return false;
  } finally {
    saveRulesButton.disabled = false;
  }
}

async function generateFeedWithUrl(targetUrl) {
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
  regenerateWithRulesButton.disabled = true;
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
    setRulesActionsEnabled(true);
    await loadRulesForSource(latestResult.sourceUrl);
    updateRulesSummaryFromResult(latestResult);
    setStatus(
      "success",
      `${latestResult.articles.length}件の記事を抽出しました。`
    );
    updatePublishButtonState();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    setStatus("error", errorMessage);
    clearPublishedInfo();
    updatePublishButtonState();
  } finally {
    generateButton.disabled = false;
    regenerateWithRulesButton.disabled = false;
  }
}

async function onGenerateClick() {
  const targetUrl = urlInput.value.trim();
  await generateFeedWithUrl(targetUrl);
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

async function onSaveRulesClick() {
  await saveRulesForCurrentSource(false);
}

async function onRegenerateWithRulesClick() {
  if (!latestResult || !latestResult.sourceUrl) {
    setStatus("error", "先にフィードを生成してください。");
    return;
  }
  const saved = await saveRulesForCurrentSource(true);
  if (!saved) {
    return;
  }
  urlInput.value = latestResult.sourceUrl;
  await generateFeedWithUrl(latestResult.sourceUrl);
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
saveRulesButton.addEventListener("click", onSaveRulesClick);
regenerateWithRulesButton.addEventListener("click", onRegenerateWithRulesClick);
saveTokenButton.addEventListener("click", onSaveTokenClick);
publishButton.addEventListener("click", onPublishClick);
copyPublishedUrlButton.addEventListener("click", onCopyPublishedUrlClick);

setRulesActionsEnabled(false);
clearRuleForm();
setRulesStatus("未設定");
refreshGithubConfig();

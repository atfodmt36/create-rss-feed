import axios from "axios";
import * as cheerio from "cheerio";
import { Feed } from "feed";

const feedExtractorLib = require("@extractus/feed-extractor") as {
  extract?: (url: string) => Promise<unknown>;
  extractFromUrl?: (url: string) => Promise<unknown>;
  default?: (url: string) => Promise<unknown>;
};

const MAX_ARTICLES = 50;

export interface FeedArticle {
  title: string;
  url: string;
  description?: string;
  publishedAt?: string;
  author?: string;
}

export interface FeedResult {
  sourceUrl: string;
  feedTitle: string;
  feedDescription: string;
  articles: FeedArticle[];
  rssXml: string;
  method: "rss-auto-detect" | "heuristic";
}

interface NormalizedFeed {
  title: string;
  description: string;
  articles: FeedArticle[];
}

function cleanText(value: string | undefined | null): string {
  if (!value) {
    return "";
  }
  return value.replace(/\s+/g, " ").trim();
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function toAbsoluteUrl(baseUrl: string, candidate: string | undefined): string | null {
  if (!candidate) {
    return null;
  }
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function uniqueArticles(articles: FeedArticle[]): FeedArticle[] {
  const byUrl = new Map<string, FeedArticle>();
  for (const article of articles) {
    if (!byUrl.has(article.url)) {
      byUrl.set(article.url, article);
    }
  }
  return Array.from(byUrl.values()).slice(0, MAX_ARTICLES);
}

async function fetchHtml(url: string): Promise<string> {
  const response = await axios.get<string>(url, {
    responseType: "text",
    timeout: 15_000,
    maxRedirects: 5,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
    },
    validateStatus: (status) => status >= 200 && status < 400
  });

  const contentType = String(response.headers["content-type"] ?? "");
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error("指定URLはHTMLページではありません。");
  }

  if (typeof response.data !== "string") {
    throw new Error("HTMLの取得に失敗しました。");
  }

  return response.data;
}

function detectFeedLinks($: cheerio.CheerioAPI, sourceUrl: string): string[] {
  const links = new Set<string>();
  $("link[href]").each((_, node) => {
    const element = $(node);
    const rel = (element.attr("rel") ?? "").toLowerCase();
    const type = (element.attr("type") ?? "").toLowerCase();
    if (!rel.includes("alternate")) {
      return;
    }
    if (!/(rss|atom|xml)/i.test(type)) {
      return;
    }
    const absoluteUrl = toAbsoluteUrl(sourceUrl, element.attr("href"));
    if (absoluteUrl && isHttpUrl(absoluteUrl)) {
      links.add(absoluteUrl);
    }
  });

  return Array.from(links).slice(0, 10);
}

function pickExtractor():
  | ((url: string) => Promise<unknown>)
  | undefined {
  const candidate =
    feedExtractorLib.extract ??
    feedExtractorLib.extractFromUrl ??
    feedExtractorLib.default;
  return typeof candidate === "function" ? candidate : undefined;
}

function parseExtractorAuthor(authorValue: unknown): string | undefined {
  if (!authorValue) {
    return undefined;
  }
  if (typeof authorValue === "string") {
    const value = cleanText(authorValue);
    return value || undefined;
  }
  if (typeof authorValue === "object" && authorValue !== null) {
    const maybeName = (authorValue as { name?: unknown }).name;
    if (typeof maybeName === "string") {
      const value = cleanText(maybeName);
      return value || undefined;
    }
  }
  return undefined;
}

function parseExtractorEntry(entry: unknown): FeedArticle | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const candidate = entry as Record<string, unknown>;
  const title = cleanText(
    (candidate.title as string | undefined) ??
      (candidate.summary as string | undefined) ??
      (candidate.contentSnippet as string | undefined)
  );
  const urlRaw =
    (candidate.link as string | undefined) ??
    (candidate.url as string | undefined) ??
    (candidate.id as string | undefined);
  if (!title || !urlRaw || !isHttpUrl(urlRaw)) {
    return null;
  }

  const description = cleanText(
    (candidate.description as string | undefined) ??
      (candidate.summary as string | undefined) ??
      (candidate.content as string | undefined) ??
      (candidate.contentSnippet as string | undefined)
  );

  const publishedAt = normalizeDate(
    (candidate.published as string | undefined) ??
      (candidate.pubDate as string | undefined) ??
      (candidate.isoDate as string | undefined) ??
      (candidate.publishedAt as string | undefined)
  );

  let author = parseExtractorAuthor(candidate.author);
  if (!author && Array.isArray(candidate.authors) && candidate.authors.length > 0) {
    author = parseExtractorAuthor(candidate.authors[0]);
  }

  return {
    title,
    url: urlRaw,
    description: description || undefined,
    publishedAt,
    author
  };
}

async function tryAutoDetectFeeds(
  sourceUrl: string,
  html: string
): Promise<NormalizedFeed | null> {
  const $ = cheerio.load(html);
  const feedLinks = detectFeedLinks($, sourceUrl);
  const extractor = pickExtractor();
  if (!extractor || feedLinks.length === 0) {
    return null;
  }

  for (const feedLink of feedLinks) {
    try {
      const extracted = (await extractor(feedLink)) as Record<string, unknown> | null;
      if (!extracted || typeof extracted !== "object") {
        continue;
      }
      const rawEntries = Array.isArray(extracted.entries)
        ? extracted.entries
        : Array.isArray(extracted.items)
          ? extracted.items
          : [];
      const normalizedEntries = uniqueArticles(
        rawEntries
          .map((entry: unknown) => parseExtractorEntry(entry))
          .filter((entry: FeedArticle | null): entry is FeedArticle => entry !== null)
      );
      if (normalizedEntries.length === 0) {
        continue;
      }

      const title =
        cleanText(extracted.title as string | undefined) ||
        cleanText($("meta[property='og:site_name']").attr("content")) ||
        new URL(sourceUrl).hostname;
      const description =
        cleanText(extracted.description as string | undefined) ||
        cleanText($("meta[name='description']").attr("content")) ||
        `${title} の自動生成フィード`;

      return {
        title,
        description,
        articles: normalizedEntries
      };
    } catch {
      // 一部フィードURLが壊れていても次候補を試す。
    }
  }

  return null;
}

function extractDateFromElement(element: cheerio.Cheerio<any>): string | undefined {
  const timeValue = cleanText(
    element.find("time[datetime]").first().attr("datetime") ??
      element.find("[datetime]").first().attr("datetime") ??
      element.find("time").first().text() ??
      element.find(".date, .published, [itemprop='datePublished']").first().text()
  );
  return normalizeDate(timeValue || undefined);
}

function extractAuthorFromElement(element: cheerio.Cheerio<any>): string | undefined {
  const author = cleanText(
    element.find("[rel='author']").first().text() ||
      element.find(".author, [itemprop='author']").first().text()
  );
  return author || undefined;
}

function extractFromContainers(
  $: cheerio.CheerioAPI,
  sourceUrl: string
): FeedArticle[] {
  const selector =
    "article, .post, .entry, .news-item, .story, .article, [itemprop='blogPost']";
  const candidates: FeedArticle[] = [];

  $(selector).each((_, node) => {
    if (candidates.length >= MAX_ARTICLES) {
      return false;
    }
    const container = $(node);
    const linkEl = container
      .find("h1 a[href], h2 a[href], h3 a[href], a[href]")
      .first();
    const articleUrl = toAbsoluteUrl(sourceUrl, linkEl.attr("href"));
    if (!articleUrl || !isHttpUrl(articleUrl)) {
      return;
    }

    const title = cleanText(
      container.find("h1, h2, h3, [itemprop='headline'], .title").first().text()
    ) || cleanText(linkEl.text());
    if (!title) {
      return;
    }

    const description = cleanText(
      container
        .find("p, .summary, .excerpt, [itemprop='description']")
        .first()
        .text()
    );
    const publishedAt = extractDateFromElement(container);
    const author = extractAuthorFromElement(container);

    candidates.push({
      title,
      url: articleUrl,
      description: description || undefined,
      publishedAt,
      author
    });
  });

  return uniqueArticles(candidates);
}

function isLikelyArticleUrl(candidateUrl: string, sourceUrl: string): boolean {
  let parsedCandidate: URL;
  let parsedSource: URL;
  try {
    parsedCandidate = new URL(candidateUrl);
    parsedSource = new URL(sourceUrl);
  } catch {
    return false;
  }

  if (parsedCandidate.hostname !== parsedSource.hostname) {
    return false;
  }

  const path = parsedCandidate.pathname.toLowerCase();
  if (!path || path === "/" || path.endsWith("/tag/")) {
    return false;
  }
  if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip)$/i.test(path)) {
    return false;
  }

  const patterns = [
    /(^|\/)(news|article|articles|post|posts|entry|entries|blog|topics)(\/|$)/i,
    /\/20\d{2}\/\d{1,2}(\/\d{1,2})?\//,
    /\/20\d{2}-\d{2}-\d{2}\//,
    /[?&](p|article_id)=\d+/i
  ];
  if (patterns.some((pattern) => pattern.test(candidateUrl))) {
    return true;
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 2) {
    const last = segments[segments.length - 1];
    return /[a-z0-9-]{12,}/i.test(last);
  }

  return false;
}

function extractFromLinksByPattern(
  $: cheerio.CheerioAPI,
  sourceUrl: string
): FeedArticle[] {
  const candidates: FeedArticle[] = [];

  $("a[href]").each((_, node) => {
    if (candidates.length >= MAX_ARTICLES) {
      return false;
    }

    const anchor = $(node);
    const articleUrl = toAbsoluteUrl(sourceUrl, anchor.attr("href"));
    if (!articleUrl || !isHttpUrl(articleUrl) || !isLikelyArticleUrl(articleUrl, sourceUrl)) {
      return;
    }

    const title = cleanText(anchor.text());
    if (title.length < 4) {
      return;
    }

    const container = anchor.closest("article, li, div, section");
    const description = cleanText(
      container.find("p, .summary, .excerpt, [itemprop='description']").first().text()
    );
    const publishedAt = extractDateFromElement(container);
    const author = extractAuthorFromElement(container);

    candidates.push({
      title,
      url: articleUrl,
      description: description || undefined,
      publishedAt,
      author
    });
  });

  return uniqueArticles(candidates);
}

function extractHeuristically(sourceUrl: string, html: string): NormalizedFeed {
  const $ = cheerio.load(html);
  const title =
    cleanText($("meta[property='og:site_name']").attr("content")) ||
    cleanText($("title").first().text()) ||
    new URL(sourceUrl).hostname;
  const description =
    cleanText($("meta[name='description']").attr("content")) ||
    `${title} の自動生成フィード`;

  const containerArticles = extractFromContainers($, sourceUrl);
  let articles: FeedArticle[];
  if (containerArticles.length >= 2) {
    articles = containerArticles;
  } else {
    const linkedArticles = extractFromLinksByPattern($, sourceUrl);
    articles = uniqueArticles([...containerArticles, ...linkedArticles]);
  }

  if (articles.length === 0) {
    throw new Error("記事を抽出できませんでした。対応していないサイト構造の可能性があります。");
  }

  return {
    title,
    description,
    articles
  };
}

function generateRssXml(
  sourceUrl: string,
  title: string,
  description: string,
  articles: FeedArticle[]
): string {
  const feed = new Feed({
    title,
    description,
    id: sourceUrl,
    link: sourceUrl,
    language: "ja",
    updated: new Date(),
    generator: "create-rss-feed",
    copyright: `${new Date().getFullYear()} ${new URL(sourceUrl).hostname}`
  });

  for (const article of articles) {
    const articleDate = article.publishedAt ? new Date(article.publishedAt) : new Date();
    const safeDate = Number.isNaN(articleDate.getTime()) ? new Date() : articleDate;

    feed.addItem({
      title: article.title,
      id: article.url,
      link: article.url,
      description: article.description ?? "",
      date: safeDate,
      author: article.author ? [{ name: article.author }] : undefined
    });
  }

  return feed.rss2();
}

export async function extractFeed(url: string): Promise<FeedResult> {
  if (!isHttpUrl(url)) {
    throw new Error("URL形式が不正です。http:// または https:// を指定してください。");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("http:// または https:// のURLのみ対応しています。");
  }

  const html = await fetchHtml(url);

  const autoDetected = await tryAutoDetectFeeds(url, html);
  if (autoDetected) {
    return {
      sourceUrl: url,
      feedTitle: autoDetected.title,
      feedDescription: autoDetected.description,
      articles: autoDetected.articles,
      rssXml: generateRssXml(url, autoDetected.title, autoDetected.description, autoDetected.articles),
      method: "rss-auto-detect"
    };
  }

  const heuristic = extractHeuristically(url, html);
  return {
    sourceUrl: url,
    feedTitle: heuristic.title,
    feedDescription: heuristic.description,
    articles: heuristic.articles,
    rssXml: generateRssXml(url, heuristic.title, heuristic.description, heuristic.articles),
    method: "heuristic"
  };
}

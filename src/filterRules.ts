export interface SourceRules {
  titleIncludes?: string[];
  titleExcludes?: string[];
  urlIncludes?: string[];
  urlExcludes?: string[];
  descriptionRequired?: boolean;
  publishedAtRequired?: boolean;
  skipTopCount?: number;
}

export interface NormalizedSourceRules {
  titleIncludes: string[];
  titleExcludes: string[];
  urlIncludes: string[];
  urlExcludes: string[];
  descriptionRequired: boolean;
  publishedAtRequired: boolean;
  skipTopCount: number;
}

export interface RuleApplicableArticle {
  title?: string;
  url?: string;
  description?: string;
  publishedAt?: string;
}

export interface SourceRuleApplyResult<T> {
  articles: T[];
  skippedTopCount: number;
  ruleFilteredCount: number;
  filteredOutCount: number;
  appliedRules?: SourceRules;
}

function normalizeTermList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((item: unknown) => (typeof item === "string" ? item.trim() : ""))
    .filter((item: string) => item.length > 0);
  return Array.from(new Set(normalized));
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeSkipTopCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : 0;
}

export function normalizeSourceRules(
  rules: SourceRules | null | undefined
): NormalizedSourceRules {
  const input = rules ?? {};
  return {
    titleIncludes: normalizeTermList(input.titleIncludes),
    titleExcludes: normalizeTermList(input.titleExcludes),
    urlIncludes: normalizeTermList(input.urlIncludes),
    urlExcludes: normalizeTermList(input.urlExcludes),
    descriptionRequired: normalizeBoolean(input.descriptionRequired),
    publishedAtRequired: normalizeBoolean(input.publishedAtRequired),
    skipTopCount: normalizeSkipTopCount(input.skipTopCount)
  };
}

export function hasActiveRules(rules: NormalizedSourceRules): boolean {
  return (
    rules.titleIncludes.length > 0 ||
    rules.titleExcludes.length > 0 ||
    rules.urlIncludes.length > 0 ||
    rules.urlExcludes.length > 0 ||
    rules.descriptionRequired ||
    rules.publishedAtRequired ||
    rules.skipTopCount > 0
  );
}

export function compactSourceRules(rules: NormalizedSourceRules): SourceRules | null {
  const compact: SourceRules = {};
  if (rules.titleIncludes.length > 0) {
    compact.titleIncludes = rules.titleIncludes;
  }
  if (rules.titleExcludes.length > 0) {
    compact.titleExcludes = rules.titleExcludes;
  }
  if (rules.urlIncludes.length > 0) {
    compact.urlIncludes = rules.urlIncludes;
  }
  if (rules.urlExcludes.length > 0) {
    compact.urlExcludes = rules.urlExcludes;
  }
  if (rules.descriptionRequired) {
    compact.descriptionRequired = true;
  }
  if (rules.publishedAtRequired) {
    compact.publishedAtRequired = true;
  }
  if (rules.skipTopCount > 0) {
    compact.skipTopCount = rules.skipTopCount;
  }
  return Object.keys(compact).length > 0 ? compact : null;
}

function includesAll(text: string, terms: string[]): boolean {
  if (terms.length === 0) {
    return true;
  }
  const lowerText = text.toLowerCase();
  return terms.every((term) => lowerText.includes(term.toLowerCase()));
}

function includesAny(text: string, terms: string[]): boolean {
  if (terms.length === 0) {
    return false;
  }
  const lowerText = text.toLowerCase();
  return terms.some((term) => lowerText.includes(term.toLowerCase()));
}

function isPresent(value: string | undefined): boolean {
  return Boolean((value ?? "").trim());
}

function matchesArticle(article: RuleApplicableArticle, rules: NormalizedSourceRules): boolean {
  const title = (article.title ?? "").trim();
  const url = (article.url ?? "").trim();

  if (!includesAll(title, rules.titleIncludes)) {
    return false;
  }
  if (includesAny(title, rules.titleExcludes)) {
    return false;
  }
  if (!includesAll(url, rules.urlIncludes)) {
    return false;
  }
  if (includesAny(url, rules.urlExcludes)) {
    return false;
  }
  if (rules.descriptionRequired && !isPresent(article.description)) {
    return false;
  }
  if (rules.publishedAtRequired && !isPresent(article.publishedAt)) {
    return false;
  }

  return true;
}

export function applySourceRules<T extends RuleApplicableArticle>(
  articles: T[],
  rulesInput?: SourceRules | null
): SourceRuleApplyResult<T> {
  const rules = normalizeSourceRules(rulesInput);
  const hasRules = hasActiveRules(rules);

  if (!hasRules) {
    return {
      articles,
      skippedTopCount: 0,
      ruleFilteredCount: 0,
      filteredOutCount: 0
    };
  }

  const skippedTopCount = Math.min(rules.skipTopCount, articles.length);
  const afterSkip = articles.slice(skippedTopCount);
  const kept = afterSkip.filter((article) => matchesArticle(article, rules));
  const ruleFilteredCount = afterSkip.length - kept.length;
  const filteredOutCount = skippedTopCount + ruleFilteredCount;

  return {
    articles: kept,
    skippedTopCount,
    ruleFilteredCount,
    filteredOutCount,
    appliedRules: compactSourceRules(rules) ?? undefined
  };
}

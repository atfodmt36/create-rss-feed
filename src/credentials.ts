const SERVICE_NAME = "create-rss-feed";
const ACCOUNT_NAME = "github_pat";

type KeytarLib = {
  setPassword: (service: string, account: string, password: string) => Promise<void>;
  getPassword: (service: string, account: string) => Promise<string | null>;
};

function getKeytar(): KeytarLib {
  try {
    return require("keytar") as KeytarLib;
  } catch {
    throw new Error("keytar が読み込めません。依存関係をインストールしてください。");
  }
}

function normalizeToken(token: string): string {
  return (token ?? "").trim();
}

export async function saveGithubToken(token: string): Promise<void> {
  const normalized = normalizeToken(token);
  if (!normalized) {
    throw new Error("GitHubトークンが空です。");
  }
  await getKeytar().setPassword(SERVICE_NAME, ACCOUNT_NAME, normalized);
}

export async function loadGithubToken(): Promise<string | null> {
  const token = await getKeytar().getPassword(SERVICE_NAME, ACCOUNT_NAME);
  return token ? token.trim() : null;
}

export async function hasGithubToken(): Promise<boolean> {
  const token = await loadGithubToken();
  return Boolean(token);
}

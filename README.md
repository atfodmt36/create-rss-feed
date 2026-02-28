# create-rss-feed

任意のWebサイトURLから記事を抽出して RSS(XML) を生成する Electron デスクトップアプリです。  
生成したRSSを GitHub Pages に公開し、Power Automate で監視できます。

## セットアップ

```bash
npm install
npm start
```

## 使い方

1. URLを入力して「フィードを生成」を実行
2. 必要なら「XMLをコピー」「RSSファイルを保存」
3. Power Automate連携する場合は「GitHub Token登録」
4. 「GitHub Pagesへ公開」で固定URLを発行

公開URLは次の形式で生成されます。

```text
https://{owner}.github.io/{repo}/feeds/{hostname}/{hash16}.xml
```

同じ元URLは同じファイルパスに上書きされるため、Power Automate側は同一URLを継続監視できます。

## 自動更新（GitHub Actions）

`gh-pages` のRSSを定期更新する workflow を同梱しています。

- workflow: `.github/workflows/auto-update-feeds.yml`
- 実行時刻（JST）: 毎日 08:00 / 12:00 / 16:00
- 実行時刻（UTC）: 前日23:00 / 03:00 / 07:00
- 手動実行: Actions 画面の `Auto Update RSS Feeds` から `Run workflow`

### 更新対象URLの管理

`config/feed-sources.json` を編集して対象を増減します。

```json
{
  "version": 1,
  "sources": [
    {
      "name": "KTS",
      "url": "https://www.kts.co.jp/",
      "enabled": true
    }
  ]
}
```

- `enabled: false` にすると一時停止できます
- `url` は `http://` または `https://` のみ有効です
- 設定から削除したURLの古いXMLは次回自動更新時に `gh-pages` から削除されます

## GitHub Token (PAT) について

- 本アプリはPATをOS資格情報ストアに保存します（Windows: Credential Manager）
- PATは少なくとも次のいずれかの権限が必要です
  - publicリポジトリのみ: `public_repo`
  - privateリポジトリ含む: `repo`

## GitHub Pages 初期設定

1. GitHubリポジトリの Settings > Pages を開く
2. Source を `Deploy from a branch` に設定
3. Branch に `gh-pages` を選択して保存

## 自動更新の公開権限

GitHub Actions は `GITHUB_TOKEN` で `gh-pages` に push します。  
workflow 側で `permissions: contents: write` を設定済みです。

## Power Automate 連携手順

1. Power Automate で新しいクラウドフローを作成
2. トリガーに RSS の `When a feed item is published` を選択
3. Feed URL に本アプリが表示した公開URLを設定
4. 後続アクションに Teams 通知 / メール送信などを追加

## 既知の制限

- JavaScriptレンダリング前提のSPAサイト（React/Vue等）には対応していません
- GitHub Pagesの反映には数十秒から数分かかる場合があります
- `origin` が GitHub 以外の場合は、自動公開できません  
  この場合は環境変数 `CREATE_RSS_FEED_REPOSITORY=owner/repo` を設定してください

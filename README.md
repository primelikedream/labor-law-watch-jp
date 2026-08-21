# 労働法制ウォッチ (labore-low)

日本の労働関連法制の変更・トピックを自動収集し、時系列ダッシュボードとメールダイジェストで発信するアプリ。

## 情報源

- [厚生労働省 新着情報RSS](https://www.mhlw.go.jp/stf/news.rdf) — タイトルに労働関連キーワードを含むものを抽出([src/keywords.ts](src/keywords.ts))
- [e-Gov 法令API](https://laws.e-gov.go.jp/) の `updatelawlists` — 施行日ベースで労働関連法令の改正を抽出

## 構成

```
src/collectors/   データ収集 (MHLW RSS, e-Gov法令API)
src/summarize.ts  Claude APIによる要約 (未設定時は簡易要約にフォールバック)
src/store.ts      docs/data/items.json への永続化・重複排除
src/fetchAll.ts   収集→要約→保存 のエントリポイント (npm run fetch)
src/digest.ts     日次/週次ダイジェスト生成・メール送信 (npm run digest:daily / digest:weekly)
src/server.ts     ローカルプレビュー用の静的サーバ (npm run serve)
docs/             ダッシュボード本体。GitHub Pagesの公開元
```

## セットアップ

```bash
npm install
cp .env.example .env   # 必要に応じて編集
```

`.env` の主な項目:

- `ANTHROPIC_API_KEY` — Claude APIキー。未設定でも動作するが、要約は簡易版になる。
- `SMTP_*` / `MAIL_FROM` / `MAIL_TO` — メール配信用。Gmailの場合は[アプリパスワード](https://support.google.com/accounts/answer/185833)を発行して`SMTP_PASS`に設定する。未設定ならメール送信はスキップされる。

## ローカル実行

```bash
npm run fetch          # 収集・要約して docs/data/items.json を更新
npm run serve           # http://localhost:5173 でダッシュボードを確認
npm run digest:daily    # 直近1日分のダイジェストを表示・メール送信
npm run digest:weekly   # 直近7日分のダイジェストを表示・メール送信
```

## 自動化 (GitHub Actions)

`.github/workflows/collect-and-publish.yml` が毎日07:00 JSTに実行され、収集・要約・日次メール送信・`docs/data/items.json`のコミット・GitHub Pagesへのデプロイまでを行う。
`.github/workflows/weekly-digest.yml` は毎週月曜07:30 JSTに週次ダイジェストメールを送信する。

### 初回セットアップ手順

1. GitHubにリポジトリを作成し、このプロジェクトをpush
2. リポジトリの Settings → Pages → Source を **GitHub Actions** に設定
3. Settings → Secrets and variables → Actions に以下を登録(必要なものだけでOK)
   - `ANTHROPIC_API_KEY`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_TO`
4. Actions タブから `Collect labor law updates and publish dashboard` を手動実行(workflow_dispatch)して動作確認

以降は毎日・毎週自動実行される。手動実行はいつでもActionsタブから可能。

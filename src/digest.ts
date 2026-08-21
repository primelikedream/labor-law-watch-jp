import { loadData } from "./store.js";
import { sendDigestMail } from "./mailer.js";
import type { CollectedItem } from "./types.js";

type Period = "daily" | "weekly";

const DEFAULT_DASHBOARD_URL = "https://primelikedream.github.io/labor-law-watch-jp/";

function parsePeriod(): Period {
  const arg = process.argv.find((a) => a.startsWith("--period="));
  const value = arg?.split("=")[1];
  return value === "weekly" ? "weekly" : "daily";
}

function withinPeriod(item: CollectedItem, days: number): boolean {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(item.publishedAt).getTime() >= cutoff;
}

function buildDigest(period: Period, days: number, itemCount: number) {
  const label = period === "daily" ? "日次" : "週次";
  const today = new Date().toISOString().slice(0, 10);
  const subject = `【労働法制ダイジェスト・${label}】${today} (${itemCount}件)`;

  const dashboardUrl = process.env.DASHBOARD_URL ?? DEFAULT_DASHBOARD_URL;
  const link = `${dashboardUrl.replace(/\/?$/, "/")}?days=${days}`;

  const intro =
    itemCount === 0
      ? `対象期間中に新しい労働関連の法改正・トピックはありませんでした。`
      : `直近${days}日間で ${itemCount} 件の労働関連トピックがあります。`;

  const text = `${intro}\n\n詳細はこちら:\n${link}`;
  const html = `
    <p>${intro}</p>
    <p><a href="${link}" style="display:inline-block;padding:0.6em 1.2em;background:#2c4a72;color:#fff;text-decoration:none;border-radius:4px;">労働法制ウォッチを見る →</a></p>
    <p style="font-size:0.85em;color:#666;">${link}</p>
  `;

  return { subject, text, html };
}

async function main() {
  const period = parsePeriod();
  const days = period === "daily" ? 1 : 7;

  const data = await loadData();
  const itemCount = data.items.filter((item) => withinPeriod(item, days)).length;

  const digest = buildDigest(period, days, itemCount);
  console.log(digest.text);

  await sendDigestMail(digest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { loadData } from "./store.js";
import { sendDigestMail } from "./mailer.js";
import { buildWeeklySynthesis } from "./synthesize.js";
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function buildDigest(period: Period, days: number, items: CollectedItem[]) {
  const itemCount = items.length;
  const label = period === "daily" ? "日次" : "週次";
  const today = new Date().toISOString().slice(0, 10);
  const subject = `【労働法制ダイジェスト・${label}】${today} (${itemCount}件)`;

  const dashboardUrl = process.env.DASHBOARD_URL ?? DEFAULT_DASHBOARD_URL;
  const link = `${dashboardUrl.replace(/\/?$/, "/")}?days=${days}`;

  if (itemCount === 0) {
    const empty = `対象期間中に新しい労働関連の法改正・トピックはありませんでした。`;
    return { subject, text: empty, html: `<p>${empty}</p>` };
  }

  // 週次のみ、Claudeによる解説記事を生成して添える(日次はリンクのみを希望する運用のため対象外)。
  const synthesis = period === "weekly" ? await buildWeeklySynthesis(items) : null;

  const intro = `直近${days}日間で ${itemCount} 件の労働関連トピックがあります。`;
  const text = [synthesis, intro, `詳細はこちら:\n${link}`].filter(Boolean).join("\n\n");
  const html = `
    ${synthesis ? `<p>${escapeHtml(synthesis).replace(/\n/g, "<br>")}</p>` : ""}
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
  const items = data.items.filter((item) => withinPeriod(item, days));

  const digest = await buildDigest(period, days, items);
  console.log(digest.text);

  await sendDigestMail(digest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

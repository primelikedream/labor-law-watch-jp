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

// 同一の出来事(storyId)は1件にまとめて重複掲載を避ける。
function dedupeByStory(items: CollectedItem[]): CollectedItem[] {
  const seen = new Set<string>();
  const result: CollectedItem[] = [];
  for (const item of items) {
    const key = item.storyId ?? item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

interface LawSection {
  text: string;
  html: string;
}

// 法令改正(e-Gov由来)の情報は、リンクのみでなく概要をメール本文に直接載せる。
function buildLawAmendmentSection(items: CollectedItem[]): LawSection | null {
  const lawItems = dedupeByStory(items.filter((item) => item.source === "egov_law_update")).sort((a, b) =>
    a.publishedAt.localeCompare(b.publishedAt),
  );
  if (lawItems.length === 0) return null;

  const textLines = [`■ 法令改正情報 (${lawItems.length}件)`];
  const htmlLines = [
    `<h3 style="margin:1em 0 0.4em;">法令改正情報 (${lawItems.length}件)</h3>`,
    `<ul style="padding-left:1.2em;margin:0;">`,
  ];
  for (const item of lawItems) {
    textLines.push(`- ${item.title}\n  ${item.summary ?? ""}\n  ${item.url}`);
    htmlLines.push(
      `<li style="margin-bottom:0.7em;"><strong>${escapeHtml(item.title)}</strong><br>` +
        `${escapeHtml(item.summary ?? "")}<br>` +
        `<a href="${item.url}">${item.url}</a></li>`,
    );
  }
  htmlLines.push(`</ul>`);

  return { text: textLines.join("\n\n"), html: htmlLines.join("\n") };
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
  // 法令改正情報は日次・週次いずれでも概要をメール本文に載せる。
  const lawSection = buildLawAmendmentSection(items);

  const intro = `直近${days}日間で ${itemCount} 件の労働関連トピックがあります。`;
  const text = [synthesis, lawSection?.text, intro, `詳細はこちら:\n${link}`].filter(Boolean).join("\n\n");
  const html = `
    ${synthesis ? `<p>${escapeHtml(synthesis).replace(/\n/g, "<br>")}</p>` : ""}
    ${lawSection ? lawSection.html : ""}
    <p style="margin-top:1em;">${intro}</p>
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

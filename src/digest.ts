import { loadData } from "./store.js";
import { sendDigestMail } from "./mailer.js";
import type { CollectedItem } from "./types.js";

type Period = "daily" | "weekly";

function parsePeriod(): Period {
  const arg = process.argv.find((a) => a.startsWith("--period="));
  const value = arg?.split("=")[1];
  return value === "weekly" ? "weekly" : "daily";
}

function withinPeriod(item: CollectedItem, days: number): boolean {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(item.publishedAt).getTime() >= cutoff;
}

function groupByDate(items: CollectedItem[]): Map<string, CollectedItem[]> {
  const groups = new Map<string, CollectedItem[]>();
  for (const item of items) {
    const dateKey = item.publishedAt.slice(0, 10);
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey)!.push(item);
  }
  return new Map([...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])));
}

function buildDigest(period: Period, items: CollectedItem[]) {
  const label = period === "daily" ? "日次" : "週次";
  const today = new Date().toISOString().slice(0, 10);
  const subject = `【労働法制ダイジェスト・${label}】${today} (${items.length}件)`;

  if (items.length === 0) {
    const empty = `対象期間中に新しい労働関連の法改正・トピックはありませんでした。`;
    return { subject, text: empty, html: `<p>${empty}</p>` };
  }

  const groups = groupByDate(items);
  const textLines: string[] = [];
  const htmlLines: string[] = [`<h2>${subject}</h2>`];

  for (const [date, dateItems] of groups) {
    textLines.push(`\n■ ${date}`);
    htmlLines.push(`<h3>${date}</h3><ul>`);
    for (const item of dateItems) {
      textLines.push(`- [${item.category}] ${item.title}`);
      textLines.push(`  ${item.summary ?? ""}`);
      textLines.push(`  ${item.url}`);
      htmlLines.push(
        `<li><strong>[${escapeHtml(item.category)}] ${escapeHtml(item.title)}</strong><br>` +
          `${escapeHtml(item.summary ?? "")}<br>` +
          `<a href="${item.url}">${item.url}</a></li>`,
      );
    }
    htmlLines.push(`</ul>`);
  }

  return { subject, text: textLines.join("\n"), html: htmlLines.join("\n") };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function main() {
  const period = parsePeriod();
  const days = period === "daily" ? 1 : 7;

  const data = await loadData();
  const items = data.items
    .filter((item) => withinPeriod(item, days))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const digest = buildDigest(period, items);
  console.log(digest.text);

  await sendDigestMail(digest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

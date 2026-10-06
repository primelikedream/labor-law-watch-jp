import { loadData } from "./store.js";
import { sendDigestMail } from "./mailer.js";
import { buildWeeklySynthesis } from "./synthesize.js";
import type { CollectedItem } from "./types.js";

type Period = "daily" | "weekly";

const DEFAULT_DASHBOARD_URL = "https://primelikedream.github.io/labor-law-watch-jp/";

// 一覧に載せる件数の上限(超過分はダッシュボードで確認する)
const LIMITS: Record<Period, { official: number; news: number }> = {
  daily: { official: 10, news: 8 },
  weekly: { official: 15, news: 12 },
};

function parsePeriod(): Period {
  const arg = process.argv.find((a) => a.startsWith("--period="));
  const value = arg?.split("=")[1];
  return value === "weekly" ? "weekly" : "daily";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

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

// 要約がタイトルの言い換えにすぎない(簡易要約)場合は表示しない。
function displaySummary(item: CollectedItem): string | null {
  const summary = item.summary?.trim();
  if (!summary) return null;
  if (summary === item.title || summary.startsWith(item.title)) return null;
  return summary;
}

function jstDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

interface Section {
  text: string;
  html: string;
}

function link(url: string): string {
  return `<a href="${url}">${url}</a>`;
}

// 法令改正: 改正内容と必要な対応を本文に直接書く。
function buildLawSection(laws: CollectedItem[]): Section | null {
  if (laws.length === 0) return null;
  const now = Date.now();

  const text: string[] = [`■ 法令改正 (${laws.length}件)`];
  const html: string[] = [`<h3 style="margin:1.2em 0 0.4em;border-bottom:2px solid #2c4a72;padding-bottom:0.2em;">法令改正 (${laws.length}件)</h3>`];

  for (const item of laws) {
    const status = new Date(item.publishedAt).getTime() <= now ? "施行済み" : "施行予定";
    const heading = `${item.title.split(" — ")[0]}(${status}: ${jstDate(item.publishedAt)})`;
    const detail = item.detail;

    text.push(`【${heading}】`);
    html.push(`<div style="margin:0.8em 0 1.2em;"><p style="margin:0 0 0.3em;"><strong>${escapeHtml(heading)}</strong></p>`);

    if (detail) {
      text.push(`改正内容:\n${detail.changes}`);
      text.push(`必要な対応:\n${detail.actions.map((a, i) => `  ${i + 1}. ${a}`).join("\n")}`);
      html.push(
        `<p style="margin:0.3em 0;"><span style="color:#2c4a72;font-weight:bold;">改正内容</span><br>${escapeHtml(detail.changes)}</p>`,
        `<p style="margin:0.3em 0 0.1em;"><span style="color:#ae3b2e;font-weight:bold;">必要な対応</span></p>`,
        `<ol style="margin:0.1em 0 0.3em;padding-left:1.4em;">${detail.actions.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ol>`,
      );
      if (detail.basis === "limited") {
        const note = "※ 条文の差分を十分に取得できなかったため、概要のみの記載です。原文でご確認ください。";
        text.push(note);
        html.push(`<p style="margin:0.2em 0;font-size:0.85em;color:#666;">${note}</p>`);
      }
    } else {
      const summary = displaySummary(item);
      if (summary) {
        text.push(summary);
        html.push(`<p style="margin:0.3em 0;">${escapeHtml(summary)}</p>`);
      }
    }
    text.push(`原文: ${item.url}`);
    html.push(`<p style="margin:0.2em 0;font-size:0.85em;">原文: ${link(item.url)}</p></div>`);
  }
  return { text: text.join("\n\n"), html: html.join("\n") };
}

function buildTopicSection(title: string, items: CollectedItem[], limit: number): Section | null {
  if (items.length === 0) return null;
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;

  const text: string[] = [`■ ${title} (${items.length}件)`];
  const html: string[] = [`<h3 style="margin:1.2em 0 0.4em;border-bottom:2px solid #2c4a72;padding-bottom:0.2em;">${escapeHtml(title)} (${items.length}件)</h3><ul style="padding-left:1.2em;margin:0;">`];

  for (const item of shown) {
    const summary = displaySummary(item);
    text.push(`・${item.title}${summary ? `\n  ${summary}` : ""}\n  ${item.url}`);
    html.push(
      `<li style="margin-bottom:0.7em;"><strong>${escapeHtml(item.title)}</strong>${summary ? `<br>${escapeHtml(summary)}` : ""}<br><span style="font-size:0.85em;">${link(item.url)}</span></li>`,
    );
  }
  html.push(`</ul>`);
  if (rest > 0) {
    const more = `(ほか${rest}件はダッシュボードでご確認ください)`;
    text.push(more);
    html.push(`<p style="font-size:0.85em;color:#666;">${more}</p>`);
  }
  return { text: text.join("\n\n"), html: html.join("\n") };
}

async function buildDigest(period: Period, days: number, items: CollectedItem[]) {
  const label = period === "daily" ? "日次" : "週次";
  const today = new Date().toISOString().slice(0, 10);
  const dashboardUrl = process.env.DASHBOARD_URL ?? DEFAULT_DASHBOARD_URL;
  const dashboard = `${dashboardUrl.replace(/\/?$/, "/")}?days=${days}`;

  const stories = dedupeByStory(items).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  // 法令改正は「期間内に施行された」か「期間内に新しく把握した(施行予定を含む)」ものを載せる。
  // 施行予定が毎日繰り返し載らないようにするため、日付だけでは判定しない。
  const laws = stories
    .filter((i) => i.source === "egov_law_update")
    .filter((i) => {
      const effective = new Date(i.publishedAt).getTime();
      return (effective >= cutoff && effective <= now) || new Date(i.fetchedAt).getTime() >= cutoff;
    })
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const others = stories.filter((i) => i.source !== "egov_law_update");
  const official = others.filter((i) => i.source === "mhlw_news");
  const news = others.filter((i) => i.source !== "mhlw_news");

  if (laws.length + others.length === 0) {
    const empty = `対象期間中に新しい労働関連の法改正・トピックはありませんでした。`;
    return { subject: `【労働法制ダイジェスト・${label}】${today}`, text: empty, html: `<p>${empty}</p>` };
  }

  const limit = LIMITS[period];
  const synthesis = period === "weekly" ? await buildWeeklySynthesis([...laws, ...others]) : null;

  const sections = [
    buildLawSection(laws),
    buildTopicSection("厚生労働省の発表・ガイドライン", official, limit.official),
    buildTopicSection("報道・専門誌の動き", news, limit.news),
  ].filter((s): s is Section => s !== null);

  const parts: string[] = [];
  if (laws.length > 0) parts.push(`法令改正${laws.length}件`);
  parts.push(`トピック${official.length + news.length}件`);
  const subject = `【労働法制ダイジェスト・${label}】${today} (${parts.join("・")})`;

  const intro = `直近${days}日間の労働関連の動きをまとめました。`;
  const text = [synthesis, intro, ...sections.map((s) => s.text), `ダッシュボード(全件・検索):\n${dashboard}`]
    .filter(Boolean)
    .join("\n\n");
  const html = `
    ${synthesis ? `<p>${escapeHtml(synthesis).replace(/\n/g, "<br>")}</p>` : ""}
    <p>${intro}</p>
    ${sections.map((s) => s.html).join("\n")}
    <p style="margin-top:1.5em;"><a href="${dashboard}" style="display:inline-block;padding:0.6em 1.2em;background:#2c4a72;color:#fff;text-decoration:none;border-radius:4px;">ダッシュボードで全件を見る →</a></p>
  `;
  return { subject, text, html };
}

async function main() {
  const period = parsePeriod();
  const days = period === "daily" ? 1 : 7;

  const data = await loadData();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  // 法令改正は施行予定(未来日付)も対象に含め、buildDigest側で期間内に新規把握/施行されたものだけに絞る。
  const items = data.items.filter(
    (item) => item.source === "egov_law_update" || new Date(item.publishedAt).getTime() >= cutoff,
  );

  const digest = await buildDigest(period, days, items);
  console.log(digest.text);

  await sendDigestMail(digest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

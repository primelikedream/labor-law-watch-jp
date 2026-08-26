import { XMLParser } from "fast-xml-parser";
import { isLaborRelatedTitle } from "../keywords.js";
import type { CollectedItem, SourceType } from "../types.js";

interface RawItem {
  title: string;
  link: string;
  guid?: string | { "#text": string };
  pubDate?: string;
}

// Googleニュース検索RSSは「個人のフィードリーダーでの非商用個人利用」に限定されている
// (レスポンスのcopyright要素参照)。見出しとリンクのみを扱い、本文は取得・保存しない。
async function searchGoogleNews(query: string): Promise<RawItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
  const res = await fetch(url, {
    headers: { "User-Agent": "labore-low-collector/0.1 (personal labor-law digest feed reader)" },
  });
  if (!res.ok) {
    throw new Error(`Google News RSS fetch failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(xml);
  const raw = doc?.rss?.channel?.item;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function guidOf(item: RawItem): string {
  if (typeof item.guid === "string") return item.guid;
  if (item.guid && typeof item.guid === "object") return item.guid["#text"];
  return item.link;
}

// タイトル末尾の " - 出典名" ｢｜出典名｣ 等の表記を取り除く(入れ子になっている場合も繰り返し剥がす)。
function stripSourceSuffix(title: string): string {
  let result = title.trim();
  for (let i = 0; i < 2; i++) {
    const stripped = result.replace(/\s?[-｜]\s?[^-｜]{1,30}$/, "").trim();
    if (stripped === result || stripped.length === 0) break;
    result = stripped;
  }
  return result;
}

export interface GoogleNewsSourceConfig {
  idPrefix: string;
  source: SourceType;
  category: string;
  queries: string[];
  errorLabel: string;
}

export async function collectViaGoogleNews(config: GoogleNewsSourceConfig): Promise<CollectedItem[]> {
  const fetchedAt = new Date().toISOString();
  const byGuid = new Map<string, RawItem>();

  for (const query of config.queries) {
    try {
      const items = await searchGoogleNews(query);
      for (const item of items) {
        if (!item?.title || !item?.link) continue;
        byGuid.set(guidOf(item), item);
      }
    } catch (err) {
      console.error(`${config.errorLabel}(Googleニュース)収集エラー:`, (err as Error).message);
    }
  }

  const collected: CollectedItem[] = [];
  for (const [guid, item] of byGuid) {
    const title = stripSourceSuffix(item.title);
    // 検索はページ全文にマッチするため、見出し自体にキーワードを含まない誤検出を除く。
    if (!isLaborRelatedTitle(title)) continue;

    const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : fetchedAt;
    collected.push({
      id: `${config.idPrefix}:${guid}`,
      source: config.source,
      title,
      url: item.link,
      publishedAt,
      category: config.category,
      fetchedAt,
    });
  }

  return collected;
}

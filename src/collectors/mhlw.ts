import { XMLParser } from "fast-xml-parser";
import { isLaborRelatedTitle } from "../keywords.js";
import type { CollectedItem } from "../types.js";

const FEED_URL = "https://www.mhlw.go.jp/stf/news.rdf";

interface RawItem {
  title: string;
  link: string;
  "dc:date"?: string;
}

export async function collectMhlwNews(): Promise<CollectedItem[]> {
  const res = await fetch(FEED_URL, {
    headers: { "User-Agent": "labore-low-collector/0.1 (labor-law digest app)" },
  });
  if (!res.ok) {
    throw new Error(`MHLW RSS fetch failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(xml);
  const rawItems: RawItem[] = doc?.["rdf:RDF"]?.item ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  const fetchedAt = new Date().toISOString();
  const collected: CollectedItem[] = [];

  for (const raw of items) {
    if (!raw?.title || !raw?.link) continue;
    const title = String(raw.title).trim();
    if (!isLaborRelatedTitle(title)) continue;

    const publishedAt = raw["dc:date"] ? new Date(raw["dc:date"]).toISOString() : fetchedAt;
    collected.push({
      id: `mhlw:${raw.link}`,
      source: "mhlw_news",
      title,
      url: raw.link,
      publishedAt,
      category: "厚労省 報道・新着情報",
      fetchedAt,
    });
  }

  return collected;
}

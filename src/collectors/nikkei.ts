import { NIKKEI_SEARCH_QUERIES } from "../keywords.js";
import { collectViaGoogleNews } from "./googleNews.js";
import type { CollectedItem } from "../types.js";

export async function collectNikkeiNews(): Promise<CollectedItem[]> {
  return collectViaGoogleNews({
    idPrefix: "nikkei",
    source: "nikkei_news",
    category: "日経新聞",
    queries: NIKKEI_SEARCH_QUERIES,
    errorLabel: "日経",
  });
}

import { ROSEI_SEARCH_QUERIES } from "../keywords.js";
import { collectViaGoogleNews } from "./googleNews.js";
import type { CollectedItem } from "../types.js";

export async function collectRoseiNews(): Promise<CollectedItem[]> {
  return collectViaGoogleNews({
    idPrefix: "rosei",
    source: "rosei_news",
    category: "労政時報",
    queries: ROSEI_SEARCH_QUERIES,
    errorLabel: "労政時報",
  });
}

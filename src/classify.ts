import { guessLegislativeStage, isGuidelineTitle } from "./keywords.js";
import type { CollectedItem } from "./types.js";

// 収集済み項目に「法制化の進捗段階」「解説・ガイドライン」の分類を付与する。
// 収集コストがかからず決定的な処理なので、新規項目だけでなく既存項目にも毎回適用し直す。
export function classifyItem(item: CollectedItem): CollectedItem {
  if (item.source === "egov_law_update") {
    return { ...item, stage: "施行", isGuideline: false };
  }
  return {
    ...item,
    stage: guessLegislativeStage(item.title),
    isGuideline: isGuidelineTitle(item.title),
  };
}

export function classifyItems(items: CollectedItem[]): CollectedItem[] {
  return items.map(classifyItem);
}

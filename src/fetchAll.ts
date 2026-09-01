import { collectMhlwNews } from "./collectors/mhlw.js";
import { collectEgovLawUpdates } from "./collectors/egov.js";
import { collectNikkeiNews } from "./collectors/nikkei.js";
import { collectRoseiNews } from "./collectors/rosei.js";
import { summarizeItems } from "./summarize.js";
import { classifyItems } from "./classify.js";
import { clusterNewItems } from "./dedupe.js";
import { filterRelevantItems } from "./relevance.js";
import { loadData, mergeItems, saveData } from "./store.js";

async function main() {
  console.log("収集開始...");
  const [mhlwItems, egovItems, nikkeiItems, roseiItems] = await Promise.all([
    collectMhlwNews().catch((err) => {
      console.error("MHLW収集エラー:", err.message);
      return [];
    }),
    collectEgovLawUpdates().catch((err) => {
      console.error("e-Gov収集エラー:", err.message);
      return [];
    }),
    collectNikkeiNews().catch((err) => {
      console.error("日経収集エラー:", err.message);
      return [];
    }),
    collectRoseiNews().catch((err) => {
      console.error("労政時報収集エラー:", err.message);
      return [];
    }),
  ]);
  console.log(
    `MHLW: ${mhlwItems.length}件 / e-Gov: ${egovItems.length}件 / 日経: ${nikkeiItems.length}件 / 労政時報: ${roseiItems.length}件 取得`,
  );

  const data = await loadData();
  const { merged, addedCount } = mergeItems(data.items, [
    ...mhlwItems,
    ...egovItems,
    ...nikkeiItems,
    ...roseiItems,
  ]);
  console.log(`新規追加: ${addedCount}件 (合計 ${merged.length}件)`);

  const toCheck = merged.filter(
    (item) => (item.source === "nikkei_news" || item.source === "rosei_news") && !item.relevanceChecked,
  ).length;
  console.log(`関連性チェック対象: ${toCheck}件`);
  const relevant = await filterRelevantItems(merged);
  console.log(`対象外として除外: ${merged.length - relevant.length}件 (残り ${relevant.length}件)`);

  console.log(`要約対象: ${relevant.filter((item) => !item.summary).length}件`);
  await summarizeItems(relevant);

  const unclustered = relevant.filter((item) => !item.storyId);
  console.log(`クラスタリング対象: ${unclustered.length}件`);
  await clusterNewItems(unclustered);

  const classified = classifyItems(relevant);

  await saveData({ updatedAt: new Date().toISOString(), items: classified });
  console.log("保存完了: docs/data/items.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

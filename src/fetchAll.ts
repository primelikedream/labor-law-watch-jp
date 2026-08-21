import { collectMhlwNews } from "./collectors/mhlw.js";
import { collectEgovLawUpdates } from "./collectors/egov.js";
import { summarizeItems } from "./summarize.js";
import { loadData, mergeItems, saveData } from "./store.js";

async function main() {
  console.log("収集開始...");
  const [mhlwItems, egovItems] = await Promise.all([
    collectMhlwNews().catch((err) => {
      console.error("MHLW収集エラー:", err.message);
      return [];
    }),
    collectEgovLawUpdates().catch((err) => {
      console.error("e-Gov収集エラー:", err.message);
      return [];
    }),
  ]);
  console.log(`MHLW: ${mhlwItems.length}件 / e-Gov: ${egovItems.length}件 取得`);

  const data = await loadData();
  const { merged, addedCount } = mergeItems(data.items, [...mhlwItems, ...egovItems]);
  console.log(`新規追加: ${addedCount}件 (合計 ${merged.length}件)`);

  console.log(`要約対象: ${merged.filter((item) => !item.summary).length}件`);
  await summarizeItems(merged);

  await saveData({ updatedAt: new Date().toISOString(), items: merged });
  console.log("保存完了: docs/data/items.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

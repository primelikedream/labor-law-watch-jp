import { collectMhlwNews } from "./collectors/mhlw.js";
import { collectEgovLawUpdates } from "./collectors/egov.js";
import { collectNikkeiNews } from "./collectors/nikkei.js";
import { collectRoseiNews } from "./collectors/rosei.js";
import { summarizeItems } from "./summarize.js";
import { classifyItems } from "./classify.js";
import { clusterNewItems } from "./dedupe.js";
import { filterRelevantItems } from "./relevance.js";
import { enrichLawAmendments } from "./amendment.js";
import {
  isLaborRelatedLawName,
  isLaborRelatedTitle,
  isOrganizationalLawName,
  isSelfRecruitmentTitle,
} from "./keywords.js";
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

  // 省庁の内部組織・独立行政法人の運営に関する法令や、労働と無関係な法令(旧データに含まれるもの)は対象外。
  const withoutOrgLaws = merged.filter((item) => {
    if (item.source === "mhlw_news") {
      // 「厚生労働大臣」等だけで拾われていた項目や、厚労省自身の職員採用案内を除く(旧データ対策)。
      return isLaborRelatedTitle(item.title) && !isSelfRecruitmentTitle(item.title);
    }
    if (item.source !== "egov_law_update") return true;
    const lawName = item.title.split(" — ")[0];
    return isLaborRelatedLawName(lawName) && !isOrganizationalLawName(lawName);
  });
  if (withoutOrgLaws.length !== merged.length) {
    console.log(`労働と無関係な法令・厚労省発表を除外: ${merged.length - withoutOrgLaws.length}件`);
  }

  const toCheck = withoutOrgLaws.filter(
    (item) => (item.source === "nikkei_news" || item.source === "rosei_news") && !item.relevanceChecked,
  ).length;
  console.log(`関連性チェック対象: ${toCheck}件`);
  const relevant = await filterRelevantItems(withoutOrgLaws);
  console.log(`対象外として除外: ${withoutOrgLaws.length - relevant.length}件 (残り ${relevant.length}件)`);

  // 要約が同じ出来事の他ソース見出しを参照できるよう、クラスタリングを要約より先に行う。
  const unclustered = relevant.filter((item) => !item.storyId);
  console.log(`クラスタリング対象: ${unclustered.length}件`);
  await clusterNewItems(unclustered);

  console.log(`要約対象: ${relevant.filter((item) => !item.summary).length}件`);
  await summarizeItems(relevant);

  // 改正内容・必要な対応の生成(条文差分に基づく)。法令改正のうち未生成のものだけが対象。
  console.log(`改正内容の生成対象: ${relevant.filter((item) => item.source === "egov_law_update" && !item.detail).length}件`);
  await enrichLawAmendments(relevant);

  const classified = classifyItems(relevant);

  await saveData({ updatedAt: new Date().toISOString(), items: classified });
  console.log("保存完了: docs/data/items.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

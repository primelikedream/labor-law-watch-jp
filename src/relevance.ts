import Anthropic from "@anthropic-ai/sdk";
import type { CollectedItem } from "./types.js";

const MODEL = "claude-sonnet-4-5";
const BATCH_SIZE = 80;

const FILTER_TOOL: Anthropic.Tool = {
  name: "filter_items",
  description: "対象外の見出しの番号を返す",
  input_schema: {
    type: "object",
    properties: {
      irrelevant_indices: {
        type: "array",
        description: "対象外(除外すべき)と判断した見出しの番号のリスト",
        items: { type: "integer" },
      },
    },
    required: ["irrelevant_indices"],
  },
};

const PROMPT_HEADER =
  `このアプリは日本の労働関連法規・人事制度についてのニュースを配信しています。以下の2種類の情報だけを対象としたいです:\n` +
  `1. 日本の労働関連法規・制度に関する情報(法改正、規制強化、行政指導、最低賃金改定、審議会の動き等)\n` +
  `2. 日本企業の人事制度・働き方に関する具体的な取組みの紹介(ジョブ型雇用の導入、育休支援策、賃上げ、ハラスメント対策、定年延長等の実施事例)\n\n` +
  `次のような見出しは対象外として除外してください:\n` +
  `- 求人広告そのもの、転職エージェントの募集情報(【】で職種・条件を列挙する形式や「転職・求人情報」を含むもの等)\n` +
  `- 日本以外の国(米国・中国・韓国・欧州等)の雇用統計・労働事情\n` +
  `- 上場企業の適時開示文書(「(適時開示)」「日経会社情報DIGITAL」等を含む株式・報酬制度の開示)\n` +
  `- スポーツ、政治家個人のスキャンダル等、労働法制や人事施策と直接関係しない話題\n` +
  `- 地域の企業誘致・移住促進など、雇用への言及が副次的なだけの地域経済ニュース\n` +
  `- 個人のキャリアエッセイ・コラム的な読み物\n\n` +
  `判断に迷う場合は除外せず残してください(過剰な除外を避けることを優先してください)。`;

// nikkei_news / rosei_news はGoogleニュース検索(キーワード一致)で拾っているため、
// 求人広告・海外ニュース・地域経済ニュース等のノイズが混じりやすい。
// Claudeに関連性を判定させ、対象外の項目を除く。MHLW/e-Gov由来の項目は判定不要(常に残す)。
// relevanceCheckedを一度trueにした項目は再判定しない(既存項目にコストをかけない)。
export async function filterRelevantItems(items: CollectedItem[]): Promise<CollectedItem[]> {
  const targets = items.filter(
    (item) => (item.source === "nikkei_news" || item.source === "rosei_news") && !item.relevanceChecked,
  );
  if (targets.length === 0) return items;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // キー未設定時は既存のキーワードフィルタのみに頼り、追加の絞り込みは行わない。
    for (const item of targets) item.relevanceChecked = true;
    return items;
  }

  const client = new Anthropic({ apiKey });
  const dropIds = new Set<string>();

  for (let offset = 0; offset < targets.length; offset += BATCH_SIZE) {
    const batch = targets.slice(offset, offset + BATCH_SIZE);
    const dropped = await filterBatch(client, batch);
    for (const id of dropped) dropIds.add(id);
  }

  for (const item of targets) item.relevanceChecked = true;
  return items.filter((item) => !dropIds.has(item.id));
}

async function filterBatch(client: Anthropic, batch: CollectedItem[]): Promise<Set<string>> {
  const listing = batch.map((item, i) => `[${i}] ${item.source}: ${item.title}`).join("\n");
  const prompt = `${PROMPT_HEADER}\n\n${listing}\n\nfilter_itemsツールで、対象外の番号一覧を返してください。`;

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      tools: [FILTER_TOOL],
      tool_choice: { type: "tool", name: "filter_items" },
      messages: [{ role: "user", content: prompt }],
    });
    const toolUse = message.content.find((block) => block.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      const input = toolUse.input as { irrelevant_indices?: unknown };
      if (Array.isArray(input.irrelevant_indices)) {
        const ids = new Set<string>();
        for (const i of input.irrelevant_indices) {
          if (Number.isInteger(i) && i >= 0 && i < batch.length) ids.add(batch[i].id);
        }
        return ids;
      }
    }
  } catch (err) {
    console.error("関連性フィルタ失敗:", (err as Error).message);
  }
  return new Set();
}

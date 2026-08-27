import Anthropic from "@anthropic-ai/sdk";
import type { CollectedItem } from "./types.js";

const MODEL = "claude-sonnet-4-5";
const BATCH_SIZE = 80; // 1回のClaude呼び出しで扱う件数の上限(入出力サイズを抑えるため)

// 未クラスタ化の項目(storyId未設定)に対して、同一の出来事を報じているものを
// Claudeにグループ化させ、storyIdを割り当てる。一度割り当てたstoryIdは以後変更しない
// (mergeItems/classifyItemsと同じく、既存項目への再処理はコスト・安定性の観点で行わない)。
export async function clusterNewItems(newItems: CollectedItem[]): Promise<void> {
  const targets = newItems.filter((item) => !item.storyId);
  if (targets.length === 0) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    for (const item of targets) item.storyId = item.id;
    return;
  }

  const client = new Anthropic({ apiKey });
  for (let offset = 0; offset < targets.length; offset += BATCH_SIZE) {
    await clusterBatch(client, targets.slice(offset, offset + BATCH_SIZE));
  }
}

async function clusterBatch(client: Anthropic, targets: CollectedItem[]): Promise<void> {
  if (targets.length < 2) {
    for (const item of targets) item.storyId = item.id;
    return;
  }

  const listing = targets.map((item, i) => `[${i}] (${item.source}) ${item.title}`).join("\n");

  const prompt =
    `以下は日本の労働関連ニュース・法令情報の見出し一覧です。番号付きで並んでいます。\n` +
    `このうち「同一の出来事・同一の法改正・同一のニュース」について報じている見出し同士をグループにまとめてください。\n` +
    `例えば、ある県の最低賃金改定について複数の見出しがあれば同じグループ、` +
    `厚労省の同じ制度変更について官庁発表と報道の両方があれば同じグループです。\n` +
    `関連が薄い、または判断がつかないものは無理にまとめず単独のグループにしてください。\n\n` +
    `${listing}\n\n` +
    `出力は他の説明文を一切含めず、番号の配列のJSON配列のみで答えてください。例: [[0,2],[1],[3,4,5]]`;

  let groups: number[][];
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = message.content.find((block) => block.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text.trim() : "";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    groups = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch (err) {
    console.error("記事クラスタリング失敗:", (err as Error).message);
    groups = [];
  }

  const assigned = new Set<number>();
  for (const group of groups) {
    const valid = group.filter((i) => Number.isInteger(i) && i >= 0 && i < targets.length && !assigned.has(i));
    if (valid.length === 0) continue;
    const storyId = targets[valid[0]].id;
    for (const i of valid) {
      targets[i].storyId = storyId;
      assigned.add(i);
    }
  }

  // グルーピング結果に含まれなかった項目は単独記事として扱う。
  targets.forEach((item, i) => {
    if (!assigned.has(i)) item.storyId = item.id;
  });
}

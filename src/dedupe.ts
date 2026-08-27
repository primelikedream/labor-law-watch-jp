import Anthropic from "@anthropic-ai/sdk";
import type { CollectedItem } from "./types.js";

const MODEL = "claude-sonnet-4-5";
const BATCH_SIZE = 80; // 1回のClaude呼び出しで扱う件数の上限(入出力サイズを抑えるため)

const GROUP_TOOL: Anthropic.Tool = {
  name: "group_stories",
  description: "見出しを、同一の具体的な出来事を重複して報じているものだけでグループ化する",
  input_schema: {
    type: "object",
    properties: {
      groups: {
        type: "array",
        description: "グループの配列。各グループは同じ出来事を報じている見出し番号のリスト(単独なら要素数1)",
        items: { type: "array", items: { type: "integer" } },
      },
    },
    required: ["groups"],
  },
};

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

  const listing = targets
    .map((item, i) => `[${i}] (${item.source}) ${item.publishedAt.slice(0, 10)}: ${item.title}`)
    .join("\n");

  const prompt =
    `以下は日本の労働関連ニュース・法令情報の見出し一覧です。各行は [番号] (出典) 日付: 見出し です。\n\n` +
    `${listing}\n\n` +
    `このうち「全く同一の具体的な出来事」を重複して報じている見出し同士だけをグループにまとめてください。\n` +
    `例: ある特定の県の特定の最低賃金改定について、官庁発表と複数メディアが同じタイミングで報じている場合。\n\n` +
    `次のようなケースは絶対に同じグループにしないでください:\n` +
    `- 同じテーマ(例: ハラスメント、賃上げ、働き方改革)についての、内容が異なる別々の記事・コラム・研修案内・Q&A・書籍/セミナー紹介\n` +
    `- 時期の異なる同種の発表(例: 別の年・別の回の春闘賃上げ集計、別の都道府県の最低賃金改定)\n` +
    `- 同じ制度についての一般的な解説記事同士\n\n` +
    `判断に迷う場合、あるいは「テーマが同じ」というだけの場合は、絶対に無理にまとめず単独のグループにしてください。` +
    `まとめて良いのは「これは明らかに同じ具体的な出来事の重複報道だ」と確信できる場合のみです。迷ったら単独にする方を選んでください。\n\n` +
    `group_storiesツールを使って結果を返してください。すべての番号を必ずいずれか1つのグループに含めてください。`;

  let groups: number[][] = [];
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: [GROUP_TOOL],
      tool_choice: { type: "tool", name: "group_stories" },
      messages: [{ role: "user", content: prompt }],
    });
    const toolUse = message.content.find((block) => block.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      const input = toolUse.input as { groups?: unknown };
      if (Array.isArray(input.groups)) {
        groups = input.groups as number[][];
      }
    }
  } catch (err) {
    console.error("記事クラスタリング失敗:", (err as Error).message);
  }

  const assigned = new Set<number>();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
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

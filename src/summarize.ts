import Anthropic from "@anthropic-ai/sdk";
import type { CollectedItem } from "./types.js";

const MODEL = "claude-sonnet-4-5";

const SOURCE_NAME: Record<CollectedItem["source"], string> = {
  egov_law_update: "e-Gov法令改正",
  nikkei_news: "日本経済新聞",
  rosei_news: "労政時報",
  mhlw_news: "厚生労働省",
};

function fallbackSummary(item: CollectedItem): string {
  if (item.source === "egov_law_update") {
    return `${item.title}${item.rawNote ? `。${item.rawNote}` : ""}`;
  }
  return `${item.title}(詳細は元記事を参照)`;
}

const SOURCE_CONTEXT: Record<CollectedItem["source"], (title: string) => string> = {
  egov_law_update: (title) => `これは法令の改正施行情報です。法令名・改正名・施行日を含むタイトル: "${title}"`,
  nikkei_news: (title) => `これは日本経済新聞の記事見出しです(本文は取得していません、見出しのみ): "${title}"`,
  rosei_news: (title) => `これは人事労務専門誌「労政時報」の記事見出しです(本文は取得していません、見出しのみ): "${title}"`,
  mhlw_news: (title) => `これは厚生労働省の報道発表・新着情報のタイトルです: "${title}"`,
};

// 同じ出来事(storyId)を報じている他ソースの見出しを、要約の材料として渡す。
// 法令名・改正名・施行日だけでは分からない具体的な内容(厚労省の解説・報道内容)を
// 実在する情報の範囲で反映させ、憶測での肉付けを避けるため。
function buildRelatedContext(item: CollectedItem, allItems: CollectedItem[]): string {
  if (!item.storyId) return "";
  const related = allItems.filter((other) => other.id !== item.id && other.storyId === item.storyId);
  if (related.length === 0) return "";

  const lines = related.map((r) => `- (${SOURCE_NAME[r.source]}) ${r.title}`).join("\n");
  return `\n\n同じ出来事を報じている他の見出し(参考情報。ここに書かれている範囲でのみ具体化してよい):\n${lines}`;
}

async function summarizeOne(client: Anthropic, item: CollectedItem, allItems: CollectedItem[]): Promise<string> {
  const context = SOURCE_CONTEXT[item.source](item.title) + buildRelatedContext(item, allItems);

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content:
          `あなたは日本の労働関連法制の動向をまとめる編集者です。以下の情報について、` +
          `労務担当者・人事担当者向けに「何がどう変わるか / 何をすべきか」が分かる日本語の要約を1〜2文(80〜120字程度)で書いてください。` +
          `関連する見出しが与えられている場合は、その内容を踏まえてより具体的に書いてください。` +
          `推測で事実を捏造せず、与えられた情報から読み取れる範囲で簡潔にまとめてください。\n\n${context}`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock && "text" in textBlock ? textBlock.text.trim() : fallbackSummary(item);
}

export async function summarizeItems(items: CollectedItem[]): Promise<CollectedItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const targets = items.filter((item) => !item.summary);
  if (targets.length === 0) return items;

  if (!apiKey) {
    for (const item of targets) {
      item.summary = fallbackSummary(item);
      item.summarizedAt = new Date().toISOString();
    }
    return items;
  }

  const client = new Anthropic({ apiKey });

  for (const item of targets) {
    try {
      item.summary = await summarizeOne(client, item, items);
    } catch (err) {
      console.error(`要約失敗 (${item.id}):`, (err as Error).message);
      item.summary = fallbackSummary(item);
    }
    item.summarizedAt = new Date().toISOString();
  }

  return items;
}

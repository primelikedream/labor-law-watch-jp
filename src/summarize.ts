import Anthropic from "@anthropic-ai/sdk";
import type { CollectedItem } from "./types.js";

const MODEL = "claude-sonnet-4-5";

function fallbackSummary(item: CollectedItem): string {
  if (item.source === "egov_law_update") {
    return `${item.title}${item.rawNote ? `。${item.rawNote}` : ""}`;
  }
  return `${item.title}(詳細は元記事を参照)`;
}

async function summarizeOne(client: Anthropic, item: CollectedItem): Promise<string> {
  const context =
    item.source === "egov_law_update"
      ? `これは法令の改正施行情報です。法令名・改正名・施行日を含むタイトル: "${item.title}"`
      : item.source === "nikkei_news"
        ? `これは日本経済新聞の記事見出しです(本文は取得していません、見出しのみ): "${item.title}"`
        : `これは厚生労働省の報道発表・新着情報のタイトルです: "${item.title}"`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content:
          `あなたは日本の労働関連法制の動向をまとめる編集者です。以下の情報について、` +
          `労務担当者・人事担当者向けに「何がどう変わるか / 何をすべきか」が分かる日本語の要約を1〜2文(80〜120字程度)で書いてください。` +
          `推測で事実を捏造せず、タイトルから読み取れる範囲で簡潔にまとめてください。\n\n${context}`,
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
      item.summary = await summarizeOne(client, item);
    } catch (err) {
      console.error(`要約失敗 (${item.id}):`, (err as Error).message);
      item.summary = fallbackSummary(item);
    }
    item.summarizedAt = new Date().toISOString();
  }

  return items;
}

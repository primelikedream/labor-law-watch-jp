import Anthropic from "@anthropic-ai/sdk";
import type { CollectedItem } from "./types.js";

const MODEL = "claude-sonnet-4-5";
const MAX_ITEMS = 100;

// 週次ダイジェスト用に、直近1週間のトピックを1つの短い解説記事にまとめる。
// APIキー未設定・対象0件・生成失敗時はnullを返し、呼び出し側はリンクのみの簡易版にフォールバックする。
export async function buildWeeklySynthesis(items: CollectedItem[]): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || items.length === 0) return null;

  // 同一ストーリーの重複記事はまとめて1件として扱う。
  const seen = new Set<string>();
  const deduped = items
    .slice()
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .filter((item) => {
      const key = item.storyId ?? item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ITEMS);

  const listing = deduped.map((item) => `- [${item.category}] ${item.title}: ${item.summary ?? ""}`).join("\n");

  const prompt =
    `あなたは人事・労務担当者向けニュースレターの編集者です。以下は直近1週間に収集した、` +
    `日本の労働関連の法改正・行政発表・報道の一覧です(カテゴリ・見出し・要約)。\n\n${listing}\n\n` +
    `これらの情報から、読者(人事・労務担当者)が押さえておくべき重要な動きを300〜450字程度の日本語の文章でまとめてください。\n` +
    `条件:\n` +
    `- 個々の記事を単純に列挙するのではなく、テーマ別に整理し、全体として「今週何が起きたか」が伝わる文章にすること\n` +
    `- 与えられた情報にない事実を推測・捏造しないこと\n` +
    `- 見出し語をそのまま長く引用せず、自分の言葉で要約すること\n` +
    `- 前置きや挨拶は不要で、本文のみを出力すること`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = message.content.find((block) => block.type === "text");
    const text = textBlock && "text" in textBlock ? textBlock.text.trim() : "";
    return text || null;
  } catch (err) {
    console.error("週次まとめ生成失敗:", (err as Error).message);
    return null;
  }
}

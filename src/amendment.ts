import Anthropic from "@anthropic-ai/sdk";
import { fetchAmendmentDiff, formatDiffForPrompt, type AmendmentDiff } from "./lawDiff.js";
import type { AmendmentDetail, CollectedItem } from "./types.js";

const MODEL = "claude-sonnet-4-5";
const MAX_PER_RUN = 80;
const REQUEST_GAP_MS = 400;

const DESCRIBE_TOOL: Anthropic.Tool = {
  name: "describe_amendment",
  description: "法令改正の内容と、事業主・人事労務担当者に必要な対応をまとめる",
  input_schema: {
    type: "object",
    properties: {
      changes: {
        type: "string",
        description: "改正内容の要約。何がどう変わるか、いつから/誰に適用されるかを2〜5文で。",
      },
      actions: {
        type: "array",
        description: "事業主・人事労務担当者に必要な対応。1項目1文、最大5項目。対応不要なら『特段の対応は不要』の旨を1項目で。",
        items: { type: "string" },
      },
    },
    required: ["changes", "actions"],
  },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// idは `egov:{LawId}:{施行日yyyymmdd}` 形式(src/collectors/egov.ts)。
function parseEgovId(id: string): { lawId: string; date: string } | null {
  const m = id.match(/^egov:([^:]+):(\d{8})$/);
  return m ? { lawId: m[1], date: m[2] } : null;
}

function relatedHeadlines(item: CollectedItem, all: CollectedItem[]): string[] {
  if (!item.storyId) return [];
  return all.filter((o) => o.id !== item.id && o.storyId === item.storyId).map((o) => o.title);
}

function limitedDetail(item: CollectedItem, diff: AmendmentDiff | null, related: string[]): AmendmentDetail {
  const parts = [`${item.title}。`];
  if (diff) {
    const first = diff.added[0]?.after ?? diff.changed[0]?.after;
    if (first) parts.push(`条文の変更箇所(抜粋): ${first.slice(0, 200)}`);
  }
  if (related.length > 0) parts.push(`関連する報道・発表: ${related.slice(0, 2).join(" / ")}`);
  return {
    changes: parts.join(" "),
    actions: ["改正後の条文を確認し、自社の就業規則・社内手続・届出書式への影響を確認する"],
    basis: "limited",
  };
}

async function describeWithClaude(
  client: Anthropic,
  item: CollectedItem,
  diff: AmendmentDiff,
  related: string[],
): Promise<AmendmentDetail> {
  const relatedBlock = related.length
    ? `\n\n同じ出来事を報じている見出し(参考):\n${related.map((t) => `- ${t}`).join("\n")}`
    : "";

  const prompt =
    `あなたは日本の労働関連法令の改正を、人事・労務担当者向けに解説する編集者です。\n` +
    `次の法令改正について、条文の差分を読み取り、「改正内容」と「必要な対応」をまとめてください。\n\n` +
    `法令改正: ${item.title}\n\n` +
    `【条文の差分(e-Gov法令データの改正前後の比較)】\n${formatDiffForPrompt(diff)}${relatedBlock}\n\n` +
    `守ること:\n` +
    `- 条文の差分と上記の見出しに書かれている事実だけを根拠にする。書かれていない制度内容・金額・期限を推測で補わない\n` +
    `- 差分が附則(施行日・経過措置)のみの場合は、いつから・どの範囲に適用されるか(適用日、経過措置の対象)を具体的に説明する\n` +
    `- 条文の言い回しは、人事労務担当者が理解できる平易な日本語に言い換える\n` +
    `- 必要な対応は、改正内容から直接導ける実務対応(例: 就業規則・社内規程の見直し、届出書式・システム設定の変更、対象者の確認、周知)に限る。対応が不要・限定的な場合は、その旨を正直に書く\n` +
    `- 条番号などの根拠を可能な範囲で添える\n\n` +
    `describe_amendmentツールで結果を返してください。`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [DESCRIBE_TOOL],
    tool_choice: { type: "tool", name: "describe_amendment" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (toolUse && toolUse.type === "tool_use") {
    const input = toolUse.input as { changes?: unknown; actions?: unknown };
    if (typeof input.changes === "string" && Array.isArray(input.actions)) {
      const actions = input.actions.filter((a): a is string => typeof a === "string" && a.trim().length > 0);
      if (input.changes.trim() && actions.length > 0) {
        return { changes: input.changes.trim(), actions: actions.slice(0, 5), basis: "law-diff" };
      }
    }
  }
  throw new Error("describe_amendmentの出力が不正");
}

// 法令改正(e-Gov由来)のうち、改正内容・必要な対応(detail)が未作成のものを生成する。
// 条文差分の取得に失敗(通信エラー等)した項目はdetailを設定せず、次回の収集時に再試行する。
export async function enrichLawAmendments(items: CollectedItem[]): Promise<void> {
  const targets = items.filter((item) => item.source === "egov_law_update" && !item.detail).slice(0, MAX_PER_RUN);
  if (targets.length === 0) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const client = apiKey ? new Anthropic({ apiKey }) : null;

  for (const item of targets) {
    const parsed = parseEgovId(item.id);
    if (!parsed) continue;

    let diff: AmendmentDiff | null;
    try {
      diff = await fetchAmendmentDiff(parsed.lawId, parsed.date);
    } catch (err) {
      console.error(`条文差分の取得失敗 (${item.id}):`, (err as Error).message);
      continue;
    }
    await sleep(REQUEST_GAP_MS);

    const related = relatedHeadlines(item, items);
    if (!diff || !client) {
      item.detail = limitedDetail(item, diff, related);
      continue;
    }
    try {
      item.detail = await describeWithClaude(client, item, diff, related);
      // タイトルのみから作った旧来の汎用的な要約は、条文差分に基づく内容の冒頭で置き換える。
      const firstSentence = item.detail.changes.split("。")[0];
      if (firstSentence) item.summary = `${firstSentence}。`;
    } catch (err) {
      console.error(`改正内容の生成失敗 (${item.id}):`, (err as Error).message);
    }
  }
}

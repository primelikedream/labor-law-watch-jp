// e-Gov法令API v2で、ある施行日の改正前後の条文を取得して差分(追加/変更/削除された条・附則・別表)を抽出する。
// 条文の実際の変更点に基づいて「改正内容」「必要な対応」を書くための材料。

const API = "https://laws.e-gov.go.jp/api/2";
const HEADERS = { "User-Agent": "labore-low-collector/0.1 (labor-law digest app)" };

const MAX_UNIT_CHARS = 1500;
const MAX_TOTAL_CHARS = 6000;

interface LawNode {
  tag?: string;
  attr?: Record<string, string>;
  children?: (LawNode | string)[];
}

interface RevisionInfo {
  law_revision_id: string;
  amendment_enforcement_date: string | null;
  amendment_scheduled_enforcement_date: string | null;
  amendment_law_title: string | null;
}

export interface UnitChange {
  label: string;
  before?: string;
  after?: string;
}

export interface AmendmentDiff {
  amendmentTitle: string | null;
  isNewLaw: boolean;
  added: UnitChange[];
  changed: UnitChange[];
  removed: UnitChange[];
  truncated: boolean;
}

const UNIT_TAGS = new Set(["Article", "SupplProvision", "AppdxTable", "AppdxStyle", "AppdxNote", "Appdx", "AppdxFig"]);

function textOf(node: LawNode | string | undefined): string {
  if (node === undefined) return "";
  if (typeof node === "string") return node;
  return (node.children ?? []).map(textOf).join("");
}

function childText(node: LawNode, tag: string): string {
  const child = (node.children ?? []).find((c): c is LawNode => typeof c !== "string" && c.tag === tag);
  return child ? textOf(child).trim() : "";
}

function labelOf(node: LawNode): string {
  const attr = node.attr ?? {};
  switch (node.tag) {
    case "Article":
      return childText(node, "ArticleTitle") || `第${attr.Num ?? "?"}条`;
    case "SupplProvision":
      return `附則${attr.AmendLawNum ? `(${attr.AmendLawNum})` : ""}`;
    default:
      return childText(node, `${node.tag}Title`) || node.tag || "別表等";
  }
}

function collectUnits(node: LawNode | string | undefined, map: Map<string, { label: string; text: string }>): void {
  if (!node || typeof node === "string") return;
  if (node.tag && UNIT_TAGS.has(node.tag)) {
    const attr = node.attr ?? {};
    const base = [node.tag, attr.Num ?? "", attr.AmendLawNum ?? ""].join("|");
    let key = base;
    for (let i = 1; map.has(key); i++) key = `${base}#${i}`;
    map.set(key, { label: labelOf(node), text: textOf(node).trim() });
    return;
  }
  for (const child of node.children ?? []) collectUnits(child, map);
}

function unitsOf(root: LawNode): Map<string, { label: string; text: string }> {
  const map = new Map<string, { label: string; text: string }>();
  collectUnits(root, map);
  return map;
}

function clip(text: string, max = MAX_UNIT_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// 変更された条について、前後で異なる箇所の周辺だけを切り出す(共通の先頭・末尾を除く)。
function diffSpan(before: string, after: string): { before: string; after: string } {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (
    s < before.length - p &&
    s < after.length - p &&
    before[before.length - 1 - s] === after[after.length - 1 - s]
  ) {
    s++;
  }
  const ctx = 40;
  const start = Math.max(0, p - ctx);
  const cut = (t: string) => `${start > 0 ? "…" : ""}${t.slice(start, Math.min(t.length, t.length - s + ctx))}${s > ctx ? "…" : ""}`;
  return { before: clip(cut(before)), after: clip(cut(after)) };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`e-Gov API ${res.status}: ${url}`);
  return (await res.json()) as T;
}

class NotFoundError extends Error {}

// 条文が提供されていない改正(政令の経過措置のみ等)は404になる。再試行しても取得できないので区別する。
async function getLawRoot(revisionId: string): Promise<LawNode> {
  const url = `${API}/law_data/${revisionId}?response_format=json`;
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 404) throw new NotFoundError(`条文なし: ${revisionId}`);
  if (!res.ok) throw new Error(`e-Gov API ${res.status}: ${url}`);
  return ((await res.json()) as { law_full_text: LawNode }).law_full_text;
}

function toCompactDate(iso: string | null): string {
  return (iso ?? "").replace(/-/g, "");
}

// 指定した施行日の改正(同日に複数ある場合はまとめて)前後の条文差分を返す。
// 該当する改正履歴が見つからなければnull(呼び出し側でフォールバックする)。通信失敗時は例外を投げる。
export async function fetchAmendmentDiff(lawId: string, enforcementDate: string): Promise<AmendmentDiff | null> {
  try {
    return await fetchAmendmentDiffUnsafe(lawId, enforcementDate);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

async function fetchAmendmentDiffUnsafe(lawId: string, enforcementDate: string): Promise<AmendmentDiff | null> {
  const history = await getJson<{ revisions: RevisionInfo[] }>(`${API}/law_revisions/${lawId}`);
  const revisions = history.revisions;

  const dateOf = (r: RevisionInfo) => toCompactDate(r.amendment_enforcement_date ?? r.amendment_scheduled_enforcement_date);
  const matchIdx = revisions.map((r, i) => (dateOf(r) === enforcementDate ? i : -1)).filter((i) => i >= 0);
  if (matchIdx.length === 0) return null;

  const newest = revisions[matchIdx[0]];
  const previous = revisions[matchIdx[matchIdx.length - 1] + 1];
  const amendmentTitle = newest.amendment_law_title;

  const newRoot = await getLawRoot(newest.law_revision_id);
  const newUnits = unitsOf(newRoot);

  const diff: AmendmentDiff = { amendmentTitle, isNewLaw: !previous, added: [], changed: [], removed: [], truncated: false };
  let budget = MAX_TOTAL_CHARS;
  const spend = (change: UnitChange) => {
    const size = (change.before?.length ?? 0) + (change.after?.length ?? 0);
    if (budget <= 0) {
      diff.truncated = true;
      return false;
    }
    budget -= size;
    return true;
  };

  if (!previous) {
    // 新規制定: 冒頭の条のみを材料にする。
    for (const { label, text } of [...newUnits.values()].slice(0, 8)) {
      const change = { label, after: clip(text, 600) };
      if (spend(change)) diff.added.push(change);
    }
    return diff;
  }

  const oldUnits = unitsOf(await getLawRoot(previous.law_revision_id));

  for (const [key, unit] of newUnits) {
    const old = oldUnits.get(key);
    if (!old) {
      const change = { label: unit.label, after: clip(unit.text) };
      if (spend(change)) diff.added.push(change);
    } else if (old.text !== unit.text) {
      const span = diffSpan(old.text, unit.text);
      const change = { label: unit.label, before: span.before, after: span.after };
      if (spend(change)) diff.changed.push(change);
    }
  }
  for (const [key, unit] of oldUnits) {
    if (!newUnits.has(key)) {
      const change = { label: unit.label, before: clip(unit.text, 600) };
      if (spend(change)) diff.removed.push(change);
    }
  }
  return diff;
}

export function formatDiffForPrompt(diff: AmendmentDiff): string {
  const lines: string[] = [];
  if (diff.amendmentTitle) lines.push(`改正の名称: ${diff.amendmentTitle}`);
  if (diff.isNewLaw) lines.push("(この法令はこの日に新規制定されたため、改正前の条文はありません。以下は冒頭の条文です)");
  for (const c of diff.added) lines.push(`[追加] ${c.label}\n${c.after}`);
  for (const c of diff.changed) lines.push(`[変更] ${c.label}\n  改正前: ${c.before}\n  改正後: ${c.after}`);
  for (const c of diff.removed) lines.push(`[削除] ${c.label}\n${c.before}`);
  if (diff.added.length + diff.changed.length + diff.removed.length === 0) {
    lines.push("(条・附則・別表の本文に差異は検出されませんでした)");
  }
  if (diff.truncated) lines.push("(差分が多いため一部のみ掲載しています)");
  return lines.join("\n");
}

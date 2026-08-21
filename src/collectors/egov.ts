import { XMLParser } from "fast-xml-parser";
import { isLaborRelatedLawName } from "../keywords.js";
import type { CollectedItem } from "../types.js";

interface RawLawInfo {
  LawTypeName?: string;
  LawName?: string;
  AmendName?: string;
  AmendPromulgationDate?: string;
  EnforcementDate?: string;
  EnforcementComment?: string;
  LawId?: string;
  LawUrl?: string;
}

function toIsoDate(yyyymmdd?: string): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return new Date().toISOString();
  const y = yyyymmdd.slice(0, 4);
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  return new Date(`${y}-${m}-${d}T00:00:00+09:00`).toISOString();
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

// 指定日に施行された法令改正一覧を取得する(e-Gov法令API v1)。
async function fetchUpdateLawList(dateStr: string): Promise<RawLawInfo[]> {
  const res = await fetch(`https://laws.e-gov.go.jp/api/1/updatelawlists/${dateStr}`, {
    headers: { "User-Agent": "labore-low-collector/0.1 (labor-law digest app)" },
  });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`e-Gov updatelawlists fetch failed (${dateStr}): ${res.status}`);
  }
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(xml);
  const raw = doc?.DataRoot?.ApplData?.LawNameListInfo;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

// 過去 lookbackDays 日分 + 未来 lookaheadDays 日分(施行予定分)の改正情報を収集する。
export async function collectEgovLawUpdates(
  lookbackDays = 3,
  lookaheadDays = 14,
): Promise<CollectedItem[]> {
  const today = new Date();
  const dates: string[] = [];
  for (let offset = -lookbackDays; offset <= lookaheadDays; offset++) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    dates.push(formatDate(d));
  }

  const fetchedAt = new Date().toISOString();
  const collected: CollectedItem[] = [];

  for (const dateStr of dates) {
    let lawInfos: RawLawInfo[];
    try {
      lawInfos = await fetchUpdateLawList(dateStr);
    } catch {
      continue; // 単日の失敗は無視して次へ
    }

    for (const info of lawInfos) {
      const lawName = info.LawName?.trim();
      if (!lawName || !isLaborRelatedLawName(lawName)) continue;

      const enforcementDate = info.EnforcementDate ?? dateStr;
      const id = `egov:${info.LawId ?? lawName}:${enforcementDate}`;
      collected.push({
        id,
        source: "egov_law_update",
        title: `${lawName} — ${info.AmendName ?? "改正"}(施行日: ${formatIsoDateJp(enforcementDate)})`,
        url: info.LawUrl ?? `https://laws.e-gov.go.jp/law/${info.LawId ?? ""}`,
        publishedAt: toIsoDate(enforcementDate),
        category: `法令改正 (${info.LawTypeName ?? "法令"})`,
        rawNote: info.EnforcementComment || undefined,
        fetchedAt,
      });
    }
  }

  return collected;
}

function formatIsoDateJp(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

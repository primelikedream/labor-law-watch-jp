export type SourceType = "mhlw_news" | "egov_law_update" | "nikkei_news" | "rosei_news";

export type LegislativeStage = "審議会検討" | "国会提出・審議" | "成立・公布" | "施行";

export interface CollectedItem {
  id: string;
  source: SourceType;
  title: string;
  url: string;
  publishedAt: string; // ISO 8601
  category: string;
  rawNote?: string;
  summary?: string;
  summarizedAt?: string;
  fetchedAt: string;
  // 見出しキーワードからの推定(egov由来の項目を除き正確性は保証しない)
  stage?: LegislativeStage;
  isGuideline?: boolean;
}

export interface DataFile {
  updatedAt: string;
  items: CollectedItem[];
}

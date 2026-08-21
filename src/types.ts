export type SourceType = "mhlw_news" | "egov_law_update";

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
}

export interface DataFile {
  updatedAt: string;
  items: CollectedItem[];
}

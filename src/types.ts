export type SourceType = "mhlw_news" | "egov_law_update" | "nikkei_news" | "rosei_news";

export type LegislativeStage = "審議会検討" | "国会提出・審議" | "成立・公布" | "施行";

// 法令改正(e-Gov由来)について、条文の差分に基づいて作成した「改正内容」と「必要な対応」。
export interface AmendmentDetail {
  changes: string;
  actions: string[];
  // law-diff: 改正前後の条文差分に基づく / limited: 差分が得られず概要のみ
  basis: "law-diff" | "limited";
}

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
  // 同一の出来事を報じている項目をまとめるためのグループID(未クラスタ化ならundefined)。
  // 一度割り当てたら変更しない。単独記事の場合は自分自身のidを持つ。
  storyId?: string;
  // nikkei_news/rosei_newsが労働法規・人事制度の話題として妥当か判定済みか。
  // true未設定のまま残る項目はない(対象外と判定された項目はストアから削除される)。
  relevanceChecked?: boolean;
  // egov_law_updateのみ。未設定なら次回の収集時に生成される。
  detail?: AmendmentDetail;
}

export interface DataFile {
  updatedAt: string;
  items: CollectedItem[];
}

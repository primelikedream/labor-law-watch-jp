// 労働関連トピックを判定するためのキーワード群。
// MHLWの新着情報は労働以外(医療・年金・子育て等)も大量に含むため、
// タイトルにこれらの語が含まれるものだけを労働関連として拾う。
export const LABOR_KEYWORDS: string[] = [
  "労働",
  "雇用",
  "賃金",
  "最低賃金",
  "労災",
  "働き方",
  "テレワーク",
  "副業",
  "兼業",
  "育児休業",
  "介護休業",
  "産休",
  "育休",
  "ハラスメント",
  "パワハラ",
  "セクハラ",
  "有給休暇",
  "時間外労働",
  "36協定",
  "派遣",
  "パートタイム",
  "有期雇用",
  "職業安定",
  "職業紹介",
  "職業能力開発",
  "技能実習",
  "特定技能",
  "外国人労働者",
  "高年齢者雇用",
  "定年",
  "均等法",
  "労使",
  "労働組合",
  "労働基準監督",
  "監督署",
  "労働政策審議会",
  "キャリアコンサル",
];

// e-Gov の法令改正リストは法令名で判定する。労働関係の主要法令。
export const LABOR_LAW_NAME_PATTERNS: string[] = [
  "労働",
  "雇用",
  "職業安定",
  "職業能力開発",
  "最低賃金",
  "賃金の支払の確保",
  "港湾労働",
  "男女雇用機会均等",
  "女性の職業生活",
  "パートタイム・有期雇用",
  "短時間労働者及び有期雇用労働者",
  "次世代育成支援",
  "高年齢者等の雇用",
  "外国人技能実習",
];

export function isLaborRelatedTitle(title: string): boolean {
  return LABOR_KEYWORDS.some((kw) => title.includes(kw));
}

export function isLaborRelatedLawName(lawName: string): boolean {
  return LABOR_LAW_NAME_PATTERNS.some((kw) => lawName.includes(kw));
}

// 見積り自動作成で使う型

// 内訳の区分（材料費 / 労務費 / どちらでもない行＝運搬費・保守点検費など）
export type Section = "material" | "labor" | "other";

export const SECTION_LABELS: Record<Section, string> = {
  material: "材料費",
  labor: "労務費",
  other: "その他",
};

// 自動計算する行（雑材料消耗品＝端数調整、返納整備費＝レンタル使用料×5%）
export type AutoKind = "misc" | "return";

// 単価の出どころ（case＝単価表になく、元にした過去の見積りの単価を使ったもの）
export type PriceSource = "draft" | "table" | "manual" | "auto" | "none" | "case";

export type QuoteItem = {
  id: string;
  section: Section;
  name: string;
  spec: string;
  // 規格が2行目以降に続く場合（名称が空で規格だけの行）
  extraSpecs: string[];
  unit: string;
  qty: number | null;
  unitPrice: number | null;
  source: PriceSource;
  // 単価表から取った時の情報
  priceDate: string | null; // YYYY-MM-DD
  priceFile: string;
  // 規格が一致せず名称だけで当てた時の、単価表側の規格（完全一致の時は空）
  priceSpec: string;
  stale: boolean;
  note: string;
  auto?: AutoKind;
  // 単価表にない時に使う単価（過去の見積りから作った下書きの、その見積りでの単価）
  fallback?: { unitPrice: number; date: string | null; file: string };
  // 材料に合わせて自動で足した（added）・直した（updated）労務の行。
  // from＝元の材料の行id。sameQty＝材料の数量に合わせる。touched＝手で直したので以後は連動しない
  link?: { from: string; kind: "added" | "updated"; sameQty: boolean; touched: boolean };
};

export type QuoteGroup = {
  id: string;
  no: string;
  name: string;
  spec: string;
  items: QuoteItem[];
  // 工事区分の「計」の上に入れる※の注意書き（1行に1つ）
  notes: string[];
  // 見積書の行の摘要
  remark?: string;
};

// 表紙の追加行（運搬費・北電申請など）
export type CoverExtra = {
  id: string;
  name: string;
  spec: string;
  unit: string;
  qty: number;
  unitPrice: number;
  // 見積書の摘要
  remark?: string;
};

// 見積書の決まった行（撤去労務費・諸経費・法定福利費）の摘要
export type FixedRemarks = { removal: string; overhead: string; welfare: string };

export const EMPTY_FIXED_REMARKS: FixedRemarks = { removal: "", overhead: "", welfare: "" };

export type CoverInfo = {
  client: string;
  title: string;
  // 表紙右側の自社情報（住所・社名・電話・取引銀行・口座・登録番号の6行）
  companyLines: string[];
};

export type QuoteSettings = {
  miscRate: number; // 雑材料消耗品の目安（材料費に対する割合）
  groupRoundUnit: number; // 工事区分ごとの計をこの単位に切り上げる（雑材料消耗品で調整）
  returnRate: number; // 返納整備費（レンタル使用料に対する割合）
  removalRate: number; // 撤去労務費（労務費に対する割合）
  removalRoundUnit: number;
  welfareRate: number; // 法定福利費（労務費＋撤去費に対する割合）
  overheadRate: number; // 諸経費の目安（法定福利費以外の計に対する割合）
  subtotalRoundUnit: number; // 税抜小計をこの単位に切り上げる（諸経費で調整）。0 = 自動
  taxRate: number;
  staleDays: number; // これより古い単価は「要確認」
  removalOverride: number | null;
  overheadOverride: number | null;
};

export const DEFAULT_SETTINGS: QuoteSettings = {
  miscRate: 0.03,
  groupRoundUnit: 1000,
  returnRate: 0.05,
  removalRate: 0.4,
  removalRoundUnit: 1000,
  welfareRate: 0.1656,
  overheadRate: 0.1,
  subtotalRoundUnit: 0,
  taxRate: 0.1,
  staleDays: 365,
  removalOverride: null,
  overheadOverride: null,
};

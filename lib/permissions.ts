// ページごとの権限レベル（DBの user_page_permissions.level と同じ値）
export const LEVEL_NONE = 0;
export const LEVEL_VIEW = 1;
export const LEVEL_OPERATE = 2;
export const LEVEL_EDIT = 3;

export type PermissionLevel = 0 | 1 | 2 | 3;

export const LEVEL_LABELS: Record<PermissionLevel, string> = {
  0: "見えない",
  1: "閲覧",
  2: "操作",
  3: "編集",
};

export type PageKey =
  | "inventory"
  | "reserves"
  | "lending"
  | "sites"
  | "report"
  | "report_logs"
  | "material_prices"
  | "logs"
  | "master"
  | "vehicles"
  | "workers"
  | "settings"
  | "permissions"
  | "operation_logs";

export type PageDef = {
  key: PageKey;
  label: string;
  href: string;
  // 閲覧・操作・編集でそれぞれ何ができるか（権限管理画面に表示）
  levels: { view: string; operate: string; edit: string };
};

// サイドバーの並び順もこの順
export const PAGES: PageDef[] = [
  { key: "inventory", label: "在庫一覧", href: "/dashboard/inventory",
    levels: { view: "在庫を見る", operate: "入庫・出庫・材料確保", edit: "操作と同じ" } },
  { key: "reserves", label: "材料確保", href: "/dashboard/reserves",
    levels: { view: "確保状況を見る", operate: "自分が担当の現場の予定日変更・削除", edit: "全現場の予定日変更・削除" } },
  { key: "lending", label: "貸出管理", href: "/dashboard/lending",
    levels: { view: "貸出状況を見る", operate: "貸出登録・自分の貸出の返却", edit: "貸出品の登録・代行返却・記録削除・返却済み履歴" } },
  { key: "sites", label: "現場リスト", href: "/dashboard/sites",
    levels: { view: "現場を見る", operate: "自分が担当の現場の詳細編集", edit: "全現場の編集・現場名/担当者の変更・会社名の管理" } },
  { key: "report", label: "日報", href: "/dashboard/report",
    levels: { view: "入力画面を見る", operate: "日報の作成・一時保存・登録", edit: "操作と同じ" } },
  { key: "report_logs", label: "日報ログ", href: "/dashboard/report-logs",
    levels: { view: "日報を見る", operate: "Excel出力", edit: "Excel出力・会社名の修正" } },
  { key: "material_prices", label: "材料単価", href: "/dashboard/material-prices",
    levels: { view: "単価を見る・見積り作成", operate: "Excel取込・手動追加", edit: "削除・重複/類似の整理" } },
  { key: "logs", label: "入出庫ログ", href: "/dashboard/logs",
    levels: { view: "ログを見る", operate: "閲覧と同じ", edit: "閲覧と同じ" } },
  { key: "master", label: "商品マスタ編集", href: "/dashboard/master",
    levels: { view: "商品を見る", operate: "商品の登録・数量加算", edit: "商品の修正・削除" } },
  { key: "vehicles", label: "車両管理", href: "/dashboard/vehicles",
    levels: { view: "車両を見る", operate: "車両の追加・修正", edit: "車両の削除" } },
  { key: "workers", label: "作業員名簿", href: "/dashboard/workers",
    levels: { view: "名簿を見る", operate: "閲覧と同じ", edit: "閲覧と同じ" } },
  { key: "settings", label: "システム設定", href: "/dashboard/settings",
    levels: { view: "設定画面を見る", operate: "登録情報の更新", edit: "操作と同じ" } },
  { key: "permissions", label: "権限管理", href: "/dashboard/permissions",
    levels: { view: "権限を見る", operate: "アカウントのプリセット割当・個別設定", edit: "プリセットの中身の変更も" } },
  { key: "operation_logs", label: "操作ログ", href: "/dashboard/operation-logs",
    levels: { view: "操作ログを見る", operate: "閲覧と同じ", edit: "閲覧と同じ" } },
];

// 社長だけが他の人に許可できるページ（社長以外は変更不可）
export const PROTECTED_PAGE_KEYS: PageKey[] = ["permissions", "operation_logs"];

// 権限管理の対象外で、社長だけが開けるページ（他の人には存在自体を見せない）
export const SUPER_ADMIN_ONLY_PATHS = ["/dashboard/employees"];

// 権限に関係なく全員が使えるページ
export const ALWAYS_ALLOWED_PATHS = ["/dashboard/profile"];


// URL → 権限キー（一時保存した日報は「日報」の権限に従う）
export function pageKeyForPath(pathname: string): PageKey | null {
  if (pathname.startsWith("/dashboard/report-drafts")) return "report";
  if (pathname.startsWith("/dashboard/report-logs")) return "report_logs";
  const page = PAGES.find((p) => pathname === p.href || pathname.startsWith(p.href + "/"));
  return page ? page.key : null;
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { usePermissions } from "@/components/PermissionsProvider";

type LogRow = {
  id: number;
  created_at: string;
  user_id: string | null;
  user_name: string;
  action: "insert" | "update" | "delete";
  category: string;
  summary: string;
  item_name: string;
  site_name: string;
  company_name: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  total_count: number;
};

type Filters = {
  query: string;
  userId: string;
  category: string;
  action: string;
  item: string;
  site: string;
  company: string;
  word: string;
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd（この日を含む）
};

const EMPTY: Filters = {
  query: "", userId: "", category: "", action: "", item: "", site: "", company: "", word: "", from: "", to: "",
};

const CATEGORIES = ["在庫", "入出庫", "日報", "材料確保", "貸出", "現場", "材料単価", "車両", "アカウント", "権限"];
const ACTIONS: Record<string, string> = { insert: "追加", update: "変更", delete: "削除" };
const ACTION_STYLES: Record<string, string> = {
  insert: "bg-green-100 text-green-800",
  update: "bg-blue-100 text-blue-800",
  delete: "bg-red-100 text-red-800",
};
const PAGE_SIZE = 50;

const FIELD_LABELS: Record<string, string> = {
  quantity: "数量", site_name: "現場名", company_name: "会社名", manager_name: "担当者", registrant_name: "登録者",
  operator_name: "操作者", name: "名前", type: "種類", maker: "メーカー", detail: "詳細", unit: "単位",
  unit_price: "単価", specification: "規格", category: "区分", source_file: "取込元", planned_date: "予定日",
  status: "状態", returned: "返却", returned_at: "返却日時", return_type: "返却種別", period_start: "貸出開始",
  period_end: "貸出終了", level: "権限", preset_key: "プリセット", role: "部署", address: "住所",
  office_location: "事務所", number: "ナンバー", vehicle_type: "車種", model: "タイプ", fuel_type: "燃料",
  work_date: "作業日", work_time: "時間", work_description: "作業内容", workers: "作業員", vehicles: "使用車両",
  note: "備考", change_type: "入出庫", email: "メール",
};
const HIDDEN_FIELDS = new Set(["id", "created_at", "updated_at", "updated_by", "user_id", "item_id", "site_id",
  "report_id", "lending_item_id", "reserve_item_id", "failed_attempts", "last_login_at", "group_index", "material_group_labels"]);

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtValue = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "（空）";
  if (typeof v === "boolean") return v ? "はい" : "いいえ";
  if (Array.isArray(v)) return v.filter(Boolean).join("・") || "（空）";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};
const localDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function OperationLogsPage() {
  const { isSuperAdmin } = usePermissions();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [debounced, setDebounced] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [suggest, setSuggest] = useState<{ items: string[]; sites: string[]; companies: string[]; users: { id: string; name: string }[] }>({
    items: [], sites: [], companies: [], users: [],
  });
  const requestId = useRef(0);

  // 入力のたびに検索しすぎないよう少し待つ
  useEffect(() => {
    const t = setTimeout(() => setDebounced(filters), 300);
    return () => clearTimeout(t);
  }, [filters]);

  useEffect(() => { setPage(0); }, [debounced]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    supabase.rpc("operation_log_suggestions").then(({ data }) => {
      if (data) setSuggest(data);
    });
  }, [isSuperAdmin]);

  const search = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    const toExclusive = debounced.to ? new Date(`${debounced.to}T00:00:00`) : null;
    if (toExclusive) toExclusive.setDate(toExclusive.getDate() + 1);
    const { data, error } = await supabase.rpc("search_operation_logs", {
      p_query: debounced.query || null,
      p_user_id: debounced.userId || null,
      p_category: debounced.category || null,
      p_action: debounced.action || null,
      p_item: debounced.item || null,
      p_site: debounced.site || null,
      p_company: debounced.company || null,
      p_word: debounced.word || null,
      p_from: debounced.from ? new Date(`${debounced.from}T00:00:00`).toISOString() : null,
      p_to: toExclusive ? toExclusive.toISOString() : null,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });
    if (id !== requestId.current) return; // 古い検索結果は捨てる
    if (error) {
      setError(`検索に失敗しました: ${error.message}`);
    } else {
      setError(null);
      const list = (data ?? []) as LogRow[];
      setRows(list);
      setTotal(list[0]?.total_count ?? 0);
    }
    setLoading(false);
  }, [debounced, page]);

  useEffect(() => {
    if (isSuperAdmin) search();
  }, [isSuperAdmin, search]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const userName = (id: string) => suggest.users.find((u) => u.id === id)?.name ?? "";
  const chips = useMemo(() => {
    const list: { label: string; clear: Partial<Filters> }[] = [];
    if (filters.query) list.push({ label: `まとめて: ${filters.query}`, clear: { query: "" } });
    if (filters.userId) list.push({ label: `人: ${userName(filters.userId) || "指定あり"}`, clear: { userId: "" } });
    if (filters.category) list.push({ label: `区分: ${filters.category}`, clear: { category: "" } });
    if (filters.action) list.push({ label: `操作: ${ACTIONS[filters.action]}`, clear: { action: "" } });
    if (filters.item) list.push({ label: `材料: ${filters.item}`, clear: { item: "" } });
    if (filters.site) list.push({ label: `現場: ${filters.site}`, clear: { site: "" } });
    if (filters.company) list.push({ label: `会社: ${filters.company}`, clear: { company: "" } });
    if (filters.word) list.push({ label: `内容: ${filters.word}`, clear: { word: "" } });
    if (filters.from || filters.to) list.push({ label: `期間: ${filters.from || "…"} 〜 ${filters.to || "…"}`, clear: { from: "", to: "" } });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, suggest.users]);

  if (!isSuperAdmin) return null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const inputCls = "border rounded p-2 text-sm w-full bg-white";

  const renderChanges = (row: LogRow) => {
    const oldD = row.old_data ?? {};
    const newD = row.new_data ?? {};
    const keys = Array.from(new Set([...Object.keys(oldD), ...Object.keys(newD)])).filter((k) => !HIDDEN_FIELDS.has(k));
    const shown = row.action === "update"
      ? keys.filter((k) => JSON.stringify(oldD[k]) !== JSON.stringify(newD[k]))
      : keys.filter((k) => fmtValue(row.action === "delete" ? oldD[k] : newD[k]) !== "（空）");
    if (shown.length === 0) return <p className="text-xs text-gray-400">詳細はありません</p>;
    return (
      <table className="text-xs w-full">
        <thead>
          <tr className="text-gray-500">
            <th className="text-left pr-2 py-1 w-28">項目</th>
            {row.action === "update" && <th className="text-left pr-2 py-1">変更前</th>}
            <th className="text-left py-1">{row.action === "update" ? "変更後" : row.action === "delete" ? "削除した内容" : "登録した内容"}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((k) => (
            <tr key={k} className="border-t">
              <td className="pr-2 py-1 text-gray-600">{FIELD_LABELS[k] ?? k}</td>
              {row.action === "update" && <td className="pr-2 py-1 text-red-700 break-all">{fmtValue(oldD[k])}</td>}
              <td className="py-1 break-all text-green-800">{fmtValue(row.action === "delete" ? oldD[k] : newD[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">操作ログ</h1>
      <p className="text-sm text-gray-600 mb-4">だれが・いつ・何を操作したかの記録です。条件はいくつでも組み合わせて絞り込めます。</p>

      {/* まとめて検索 */}
      <div className="bg-white border rounded-lg p-4 mb-3">
        <label className="text-sm font-medium block mb-1">まとめて検索</label>
        <input
          type="search"
          value={filters.query}
          onChange={(e) => set({ query: e.target.value })}
          placeholder="例：伊藤 出庫 VVF　（人・内容・材料・現場・会社のどこかに含まれるもの。スペースで区切ると全部含むものに絞り込み）"
          className="border rounded p-3 w-full text-base"
        />
        <div className="flex flex-wrap gap-2 mt-3 text-sm">
          <span className="text-gray-500 self-center">期間：</span>
          {([
            ["今日", 0],
            ["7日", -6],
            ["30日", -29],
          ] as const).map(([label, offset]) => (
            <button
              key={label}
              onClick={() => set({ from: localDate(offset), to: localDate(0) })}
              className={`px-3 py-1 rounded border ${filters.from === localDate(offset) && filters.to === localDate(0) ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-50"}`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => set({ from: "", to: "" })}
            className={`px-3 py-1 rounded border ${!filters.from && !filters.to ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-50"}`}
          >
            全期間
          </button>
          <button onClick={() => setShowDetail((v) => !v)} className="ml-auto px-3 py-1 rounded border hover:bg-gray-50">
            {showDetail ? "詳しい条件を閉じる ▲" : "詳しい条件で絞る ▼"}
          </button>
        </div>

        {showDetail && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">人</label>
              <select value={filters.userId} onChange={(e) => set({ userId: e.target.value })} className={inputCls}>
                <option value="">すべて</option>
                {suggest.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">区分</label>
              <select value={filters.category} onChange={(e) => set({ category: e.target.value })} className={inputCls}>
                <option value="">すべて</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">操作</label>
              <select value={filters.action} onChange={(e) => set({ action: e.target.value })} className={inputCls}>
                <option value="">すべて</option>
                {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">内容のワード</label>
              <input value={filters.word} onChange={(e) => set({ word: e.target.value })} placeholder="例：返却、削除、数量" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">材料名</label>
              <input list="oplog-items" value={filters.item} onChange={(e) => set({ item: e.target.value })} placeholder="一部でもOK" className={inputCls} />
              <datalist id="oplog-items">{suggest.items.map((v) => <option key={v} value={v} />)}</datalist>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">現場名</label>
              <input list="oplog-sites" value={filters.site} onChange={(e) => set({ site: e.target.value })} placeholder="一部でもOK" className={inputCls} />
              <datalist id="oplog-sites">{suggest.sites.map((v) => <option key={v} value={v} />)}</datalist>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">会社名</label>
              <input list="oplog-companies" value={filters.company} onChange={(e) => set({ company: e.target.value })} placeholder="一部でもOK" className={inputCls} />
              <datalist id="oplog-companies">{suggest.companies.map((v) => <option key={v} value={v} />)}</datalist>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">期間（日付指定）</label>
              <div className="flex items-center gap-1">
                <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className={inputCls} />
                <span className="text-gray-400">〜</span>
                <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className={inputCls} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 絞り込み中の条件 */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {chips.map((c) => (
            <button
              key={c.label}
              onClick={() => set(c.clear)}
              className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-2 py-1 rounded-full hover:bg-blue-100"
              title="クリックでこの条件を外す"
            >
              {c.label} ✕
            </button>
          ))}
          <button onClick={() => setFilters(EMPTY)} className="text-xs text-gray-500 underline">すべてクリア</button>
        </div>
      )}

      <div className="flex items-center justify-between mb-2 text-sm text-gray-600">
        <span>{loading ? "検索中..." : `${total.toLocaleString()}件`}</span>
        <span className="text-xs text-gray-400">人・区分・材料・現場をクリックすると、その条件で絞り込めます</span>
      </div>

      {error && <p className="mb-3 p-2 rounded bg-red-100 text-red-700 text-sm">{error}</p>}

      <div className="bg-white border rounded-lg divide-y">
        {rows.length === 0 && !loading && (
          <p className="p-6 text-center text-gray-400 text-sm">該当する操作はありません</p>
        )}
        {rows.map((row) => (
          <div key={row.id} className="p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-gray-500 whitespace-nowrap tabular-nums">{fmtDate(row.created_at)}</span>
              {row.user_id ? (
                <button onClick={() => set({ userId: row.user_id! })} className="font-medium hover:underline">{row.user_name || "（名前なし）"}</button>
              ) : (
                <span className="font-medium text-gray-500">{row.user_name}</span>
              )}
              <button onClick={() => set({ category: row.category })} className="text-xs px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200">{row.category}</button>
              <button onClick={() => set({ action: row.action })} className={`text-xs px-2 py-0.5 rounded ${ACTION_STYLES[row.action]}`}>{ACTIONS[row.action]}</button>
            </div>
            <button
              onClick={() => setExpanded(expanded === row.id ? null : row.id)}
              className="text-left w-full mt-1 text-sm hover:text-blue-700"
            >
              {row.summary}
              <span className="text-gray-400 text-xs ml-1">{expanded === row.id ? "▲" : "▼ 詳細"}</span>
            </button>
            {(row.item_name || row.site_name || row.company_name) && (
              <div className="flex flex-wrap gap-2 mt-1 text-xs">
                {row.item_name && (
                  <button onClick={() => set({ item: row.item_name })} className="px-2 py-0.5 rounded bg-yellow-50 border border-yellow-200 hover:bg-yellow-100">材料: {row.item_name}</button>
                )}
                {row.site_name && (
                  <button onClick={() => set({ site: row.site_name })} className="px-2 py-0.5 rounded bg-purple-50 border border-purple-200 hover:bg-purple-100">現場: {row.site_name}</button>
                )}
                {row.company_name && (
                  <button onClick={() => set({ company: row.company_name })} className="px-2 py-0.5 rounded bg-teal-50 border border-teal-200 hover:bg-teal-100">会社: {row.company_name}</button>
                )}
              </div>
            )}
            {expanded === row.id && <div className="mt-2 p-2 bg-gray-50 rounded">{renderChanges(row)}</div>}
          </div>
        ))}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 mt-4 text-sm">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading} className="px-3 py-1 rounded border disabled:opacity-40">前へ</button>
          <span>{page + 1} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1 || loading} className="px-3 py-1 rounded border disabled:opacity-40">次へ</button>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import NoteLines from "@/components/NoteLines";
import QuoteConditionsForm from "@/components/QuoteConditionsForm";
import SuggestInput, { type SuggestOption } from "@/components/SuggestInput";
import { supabase } from "@/lib/supabaseClient";
import { calcCover, calcGroup, isBlankItem, withAutoItems } from "@/lib/quote/calc";
import {
  EMPTY_CONDITIONS,
  conditionParts,
  draftFromCase,
  rankCases,
  type CaseConditions,
  type CaseGroup,
  type MatchLevel,
  type QuoteCaseInfo,
} from "@/lib/quote/cases";
import { fetchAllCaseGroups, fetchCase, fetchCaseInfos } from "@/lib/quote/caseStore";
import { buildCatalog, learnPairs, mainUnit, nameOptions, noteOptions, specOptions } from "@/lib/quote/catalog";
import {
  addItem,
  blankGroup,
  changeSection,
  commitMaterial,
  fillUnit,
  removeItem,
  renumber,
  reprice,
  syncLinkedQty,
} from "@/lib/quote/edit";
import { buildQuoteWorkbook, quoteFileName } from "@/lib/quote/exportExcel";
import { displayText, normKey } from "@/lib/quote/normalize";
import { newId, parseDraftWorkbook } from "@/lib/quote/parseDraft";
import {
  applyPriceTable,
  buildPriceIndex,
  suggestPrices,
  type PriceCandidate,
  type PriceIndex,
  type PriceRow,
} from "@/lib/quote/prices";
import {
  DEFAULT_SETTINGS,
  EMPTY_FIXED_REMARKS,
  SECTION_LABELS,
  type CoverExtra,
  type CoverInfo,
  type FixedRemarks,
  type QuoteGroup,
  type QuoteItem,
  type QuoteSettings,
  type Section,
} from "@/lib/quote/types";

const COMPANY_STORAGE_KEY = "quote.companyLines";
const DEFAULT_COMPANY_LINES = [
  "　　　札幌市白石区菊水5条2丁目4-5",
  "　　丸弘佐々木電設株式会社",
  "　　　電　　　話　　（011）832-8551",
  "",
  "",
  "　　　 登録番号　　T9-4300-0102-3675",
];

// 表紙によく入る行（過去の見積りから）
const EXTRA_PRESETS: Omit<CoverExtra, "id">[] = [
  { name: "運搬費", spec: "", unit: "回", qty: 2, unitPrice: 3000 },
  { name: "運搬費", spec: "4ｔユニック車", unit: "回", qty: 2, unitPrice: 30000 },
  { name: "普通運搬費", spec: "", unit: "回", qty: 2, unitPrice: 3000 },
  { name: "北電申請書類作成・提出", spec: "", unit: "件", qty: 1, unitPrice: 20000 },
];

const SECTIONS: Section[] = ["material", "labor", "other"];
const UNITS = ["ｍ", "本", "台", "面", "ヶ所", "ケ", "組", "式", "回", "件", "基", "台月", "ヶ月"];

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const num = (n: number | null) => (n === null ? "" : n.toLocaleString("ja-JP"));

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadCompanyLines(): string[] {
  try {
    const saved = localStorage.getItem(COMPANY_STORAGE_KEY);
    if (saved) {
      const lines = JSON.parse(saved);
      if (Array.isArray(lines)) return lines.map(String);
    }
  } catch {
    // 保存できない環境では既定値
  }
  return DEFAULT_COMPANY_LINES;
}

function saveCompanyLines(lines: string[]) {
  try {
    localStorage.setItem(COMPANY_STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // 保存できなくても続行
  }
}

async function fetchAllPrices(): Promise<PriceRow[]> {
  const rows: PriceRow[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from("material_prices")
      .select("id, category, name, specification, unit, unit_price, source_file, created_at, updated_at")
      .order("id")
      .range(from, from + size - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as PriceRow[]));
    if (!data || data.length < size) break;
  }
  return rows;
}

function SourceBadge({ item }: { item: QuoteItem }) {
  const base = "inline-block px-1.5 py-0.5 rounded text-xs whitespace-nowrap";
  switch (item.source) {
    case "draft":
      return <span className={`${base} bg-gray-100 text-gray-700`}>下書きの単価</span>;
    case "manual":
      return <span className={`${base} bg-blue-100 text-blue-700`}>手入力</span>;
    case "auto":
      return <span className={`${base} bg-purple-100 text-purple-700`}>自動計算</span>;
    case "none":
      return <span className={`${base} bg-red-100 text-red-700`}>単価表になし</span>;
    case "case":
      return (
        <span className={`${base} bg-orange-100 text-orange-800`} title={item.priceFile}>
          元の見積りの単価（{item.priceDate ?? "日付不明"}）
        </span>
      );
    case "table":
      if (item.stale) {
        return (
          <span className={`${base} bg-orange-100 text-orange-800`} title={item.priceFile}>
            要確認（{item.priceDate ? `${item.priceDate}の単価` : "日付不明"}）
          </span>
        );
      }
      if (item.priceSpec) {
        return (
          <span className={`${base} bg-amber-100 text-amber-800`} title={item.priceFile}>
            規格違い（{displayText(item.priceSpec)}）
          </span>
        );
      }
      return (
        <span className={`${base} bg-green-100 text-green-700`} title={item.priceFile}>
          単価表 {item.priceDate ?? ""}
        </span>
      );
  }
}

const MATCH_STYLES: Record<MatchLevel, string> = {
  same: "bg-green-100 text-green-800",
  near: "bg-yellow-100 text-yellow-800",
  diff: "bg-gray-100 text-gray-500 line-through",
  unknown: "bg-gray-50 text-gray-400",
};

export default function QuoteBuilderPage() {
  const [index, setIndex] = useState<PriceIndex | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  // 作り方：下書きExcelから / 似た見積りから
  const [mode, setMode] = useState<"draft" | "case">("draft");
  const [query, setQuery] = useState<CaseConditions>(EMPTY_CONDITIONS);
  const [caseInfos, setCaseInfos] = useState<QuoteCaseInfo[] | null>(null);
  const [casesError, setCasesError] = useState<string | null>(null);
  const [showMoreCases, setShowMoreCases] = useState(false);
  const [loadingCaseId, setLoadingCaseId] = useState<string | null>(null);
  const [baseCase, setBaseCase] = useState<QuoteCaseInfo | null>(null);

  const [fileName, setFileName] = useState("");
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const [groups, setGroups] = useState<QuoteGroup[]>([]);
  const [cover, setCover] = useState<CoverInfo>({ client: "", title: "", companyLines: DEFAULT_COMPANY_LINES });
  const [date, setDate] = useState(todayString());
  const [coverNotes, setCoverNotes] = useState<string[]>([]);
  const [fixedRemarks, setFixedRemarks] = useState<FixedRemarks>(EMPTY_FIXED_REMARKS);
  const [extras, setExtras] = useState<CoverExtra[]>([{ id: newId("x"), ...EXTRA_PRESETS[0] }]);
  const [settings, setSettings] = useState<QuoteSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [openSuggest, setOpenSuggest] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // 内訳を直す時の候補と、材料→労務の組み合わせ（見積り事例の内訳から覚える）
  const [caseGroups, setCaseGroups] = useState<CaseGroup[]>([]);
  const [caseGroupsError, setCaseGroupsError] = useState<string | null>(null);
  const [focusItemId, setFocusItemId] = useState<string | null>(null);

  useEffect(() => {
    setCover((c) => ({ ...c, companyLines: loadCompanyLines() }));
    fetchAllPrices()
      .then((rows) => setIndex(buildPriceIndex(rows)))
      .catch((e) => setPriceError(`単価表の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`));
    // 事例の一覧は「似た見積りから」と宛先の候補に使う
    fetchCaseInfos()
      .then(setCaseInfos)
      .catch((e) => setCasesError(`見積り事例の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`));
    fetchAllCaseGroups()
      .then(setCaseGroups)
      .catch((e) =>
        setCaseGroupsError(`見積り事例を読めなかったため、労務の自動追加は使えません（${e instanceof Error ? e.message : String(e)}）`),
      );
  }, []);

  const catalog = useMemo(() => buildCatalog(index, caseGroups), [index, caseGroups]);
  const pairModel = useMemo(() => learnPairs(caseGroups), [caseGroups]);
  const noteOpts = useMemo(() => noteOptions(caseGroups, ["※支給品"]).map((n) => ({ value: n })), [caseGroups]);
  const nameOpts = useMemo(() => {
    const out = {} as Record<Section, SuggestOption[]>;
    for (const s of SECTIONS) out[s] = nameOptions(catalog, s).map((n) => ({ value: displayText(n.name), hint: mainUnit(n) }));
    return out;
  }, [catalog]);

  // 宛先の候補：登録済みの見積り事例の宛先（使った回数が多い順、同じなら新しい順）
  const clientOpts = useMemo(() => {
    const byKey = new Map<string, { value: string; count: number; latest: string }>();
    for (const c of caseInfos ?? []) {
      const value = c.client.trim();
      if (!value) continue;
      const key = normKey(value);
      const date = c.quoteDate ?? "";
      const hit = byKey.get(key);
      if (!hit) byKey.set(key, { value, count: 1, latest: date });
      else {
        hit.count += 1;
        if (date > hit.latest) Object.assign(hit, { value, latest: date });
      }
    }
    return [...byKey.values()]
      .sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest))
      .map((c): SuggestOption => ({ value: c.value, hint: `${c.count}件` }));
  }, [caseInfos]);

  const priceCount = index?.all.length ?? 0;

  const loadDraft = useCallback(
    (data: ArrayBuffer, sheet?: string) => {
      const parsed = parseDraftWorkbook(data, sheet);
      setSheetNames(parsed.sheetNames);
      setSheetName(parsed.sheetName);
      setWarnings(parsed.warnings);
      const withAuto = parsed.groups.map(withAutoItems);
      setGroups(
        index
          ? withAuto.map((g) => ({ ...g, items: applyPriceTable(g.items, index, settings.staleDays) }))
          : withAuto,
      );
      setCover((c) => ({
        client: parsed.cover.client ?? c.client,
        title: parsed.cover.title ?? c.title,
        companyLines: parsed.cover.companyLines ?? c.companyLines,
      }));
    },
    [index, settings.staleDays],
  );

  // 単価表の読み込みが後になった時・要確認の日数を変えた時に当てはめ直す
  useEffect(() => {
    if (!index) return;
    setGroups((gs) => gs.map((g) => ({ ...g, items: applyPriceTable(g.items, index, settings.staleDays) })));
  }, [index, settings.staleDays]);


  const ranked = useMemo(
    () => (caseInfos ? rankCases(query, caseInfos, showMoreCases ? 10 : 3) : []),
    [caseInfos, query, showMoreCases],
  );
  const hasQuery = conditionParts(query).length > 0;

  const loadCase = async (info: QuoteCaseInfo) => {
    if (!info.id) return;
    if (groups.length > 0 && !confirm("いま作っている内訳を、この見積りの内容で置き換えますか？")) return;
    setLoadingCaseId(info.id);
    try {
      const c = await fetchCase(info.id);
      const draft = draftFromCase(c, index, { durationMonths: query.durationMonths, staleDays: settings.staleDays });
      setGroups(draft.groups);
      setExtras(draft.extras);
      setWarnings(draft.messages);
      setBaseCase(info);
      setFileName("");
      setFileData(null);
      setSheetNames([]);
      setTimeout(() => document.getElementById("quote-cover")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      alert(`見積りの読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingCaseId(null);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = await file.arrayBuffer();
      setFileName(file.name);
      setFileData(data);
      setBaseCase(null);
      loadDraft(data);
    } catch (e) {
      setWarnings([`ファイルを読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`]);
    }
  };

  const calcs = useMemo(() => groups.map((g) => calcGroup(g, settings)), [groups, settings]);
  const coverCalc = useMemo(() => calcCover(calcs, extras, settings), [calcs, extras, settings]);

  const allItems = groups.flatMap((g) => g.items).filter((i) => !i.auto && !isBlankItem(i));
  const missingCount = allItems.filter((i) => i.unitPrice === null).length;
  const staleCount = allItems.filter((i) => i.source === "table" && i.stale).length;
  const specMismatchCount = allItems.filter((i) => i.source === "table" && !i.stale && i.priceSpec).length;
  const caseCount = allItems.filter((i) => i.source === "case").length;

  const updateGroup = (gid: string, fn: (g: QuoteGroup) => QuoteGroup) => {
    setGroups((gs) => gs.map((g) => (g.id === gid ? fn(g) : g)));
  };

  // 画面で直した行。材料に合わせて自動で入れた労務を手で直したら、以後は材料と連動しない
  const updateItem = (gid: string, iid: string, patch: Partial<QuoteItem>) => {
    updateGroup(gid, (g) => ({
      ...g,
      items: g.items.map((i) => (i.id !== iid ? i : { ...i, ...patch, ...(i.link ? { link: { ...i.link, touched: true } } : {}) })),
    }));
  };

  const pairCtx = { model: pairModel, index, staleDays: settings.staleDays };

  // 名称・規格が決まった時（候補から選んだ・手入力して欄を離れた）：単位を補い、単価を当て直し、材料なら労務を足す
  const commitText = (gid: string, iid: string, field: "name" | "spec", value: string, option: SuggestOption | null, prev: string) => {
    updateGroup(gid, (g) => {
      const item = g.items.find((i) => i.id === iid);
      if (!item) return g;
      let next: QuoteItem = { ...item, [field]: value };
      if (option?.hint && (field === "spec" || !next.unit.trim())) next.unit = option.hint;
      next = reprice(fillUnit(next, catalog), index, settings.staleDays, true);
      let out: QuoteGroup = { ...g, items: g.items.map((i) => (i.id === iid ? next : i)) };
      if (next.section === "material") {
        const before = field === "name" ? { name: prev, spec: next.spec } : { name: next.name, spec: prev };
        out = commitMaterial(out, iid, before, pairCtx);
      }
      return out;
    });
  };

  const setItemQty = (gid: string, item: QuoteItem, value: string) => {
    const v = value.trim();
    const n = Number(v);
    const qty = v === "" ? null : isNaN(n) ? item.qty : n;
    updateItem(gid, item.id, { qty });
    if (item.section === "material") updateGroup(gid, (g) => syncLinkedQty(g, item.id, qty));
  };

  const setItemSection = (gid: string, iid: string, section: Section) => {
    updateGroup(gid, (g) => {
      const moved = changeSection(g, iid, section, index, settings.staleDays);
      return section === "material" ? commitMaterial(moved, iid, null, pairCtx) : moved;
    });
  };

  const addRow = (gid: string, section: Section) => {
    const id = newId("i");
    updateGroup(gid, (g) => addItem(g, section, id).group);
    setFocusItemId(id);
  };

  const removeGroup = (g: QuoteGroup) => {
    if (g.items.some((i) => !isBlankItem(i)) && !confirm(`「${g.no}. ${g.name || "（名称なし）"}」を内訳から削除しますか？`)) return;
    setGroups((gs) => renumber(gs.filter((x) => x.id !== g.id)));
  };

  const setItemPrice = (gid: string, item: QuoteItem, value: string) => {
    const v = value.replace(/[,，¥￥\s]/g, "");
    if (v === "") {
      // 空にしたら自動計算 / 単価表の単価に戻す
      if (item.auto) updateItem(gid, item.id, { unitPrice: null, source: "auto" });
      else if (index) updateItem(gid, item.id, applyPriceTable([{ ...item, source: "none" }], index, settings.staleDays)[0]);
      else updateItem(gid, item.id, { unitPrice: null, source: "none" });
      return;
    }
    const n = Number(v);
    if (!isNaN(n)) updateItem(gid, item.id, { unitPrice: n, source: "manual", stale: false, priceSpec: "" });
  };

  const pickCandidate = (gid: string, item: QuoteItem, c: PriceCandidate) => {
    updateItem(gid, item.id, {
      unitPrice: c.unitPrice,
      source: "manual",
      priceDate: c.date,
      priceFile: c.sourceFile,
      priceSpec: "",
      stale: false,
    });
    setOpenSuggest(null);
  };

  const updateExtra = (id: string, patch: Partial<CoverExtra>) => setExtras((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const setSetting = (key: keyof QuoteSettings, value: string, percent = false) => {
    const v = value.trim();
    if (key === "removalOverride" || key === "overheadOverride") {
      setSettings((s) => ({ ...s, [key]: v === "" ? null : Number(v.replace(/,/g, "")) }));
      return;
    }
    const n = Number(v);
    if (v === "" || isNaN(n)) return;
    setSettings((s) => ({ ...s, [key]: percent ? n / 100 : n }));
  };

  const handleDownload = async () => {
    if (groups.length === 0) return;
    if (missingCount > 0 && !confirm(`単価が入っていない品目が${missingCount}件あります（Excelでは黄色になります）。このまま作成しますか？`)) return;
    setDownloading(true);
    try {
      const [y, m, d] = date.split("-").map(Number);
      const when = new Date(y, (m || 1) - 1, d || 1);
      const data = await buildQuoteWorkbook({
        cover,
        date: when,
        coverNotes,
        fixedRemarks,
        groups,
        calcs,
        extras,
        coverCalc,
        settings,
      });
      saveCompanyLines(cover.companyLines);
      const blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = quoteFileName(when, cover.title);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      alert(`Excelの作成に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDownloading(false);
    }
  };

  const input = "border rounded px-2 py-1 text-sm";

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-2xl font-bold">見積り作成</h1>
        <Link href="/dashboard/material-prices" className="text-sm text-blue-600 hover:underline">
          材料単価へ戻る
        </Link>
      </div>

      <div className="flex gap-1 mb-0 border-b">
        {(
          [
            ["draft", "下書きのExcelから作る"],
            ["case", "似た見積りから作る"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`px-4 py-2 text-sm rounded-t border border-b-0 ${mode === key ? "bg-white font-bold -mb-px" : "bg-gray-100 text-gray-600 hover:bg-gray-50"}`}
            onClick={() => setMode(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 1. 下書きの読み込み / 似た見積りを探す */}
      <section className="bg-white border border-t-0 rounded-b-lg p-4 mb-4">
        {mode === "draft" ? (
          <>
            <p className="text-sm text-gray-600 mb-3">
              品目と数量だけを入れた内訳（「内訳 (悠介さん)」の形）のExcelを選ぶと、材料単価の表から単価を当てはめ、
              撤去労務費・諸経費・法定福利費を計算して、今までと同じ書式の見積書Excelを作ります。
            </p>
            <h2 className="font-bold mb-2">1. 下書きのExcelを選ぶ</h2>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 cursor-pointer text-sm">
                Excelファイルを選択
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    handleFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {fileName && <span className="text-sm">{fileName}</span>}
              {sheetNames.length > 1 && (
                <label className="text-sm flex items-center gap-1">
                  読み取るシート
                  <select
                    className={input}
                    value={sheetName}
                    onChange={(e) => fileData && loadDraft(fileData, e.target.value)}
                  >
                    {sheetNames.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600 mb-3">
              新しい現場の条件を入れると、登録済みの過去の見積りから条件の近いものを探します。選んだ見積りの品目と数量をコピーし、
              単価は材料単価の表の最新に入れ直します。工期を入れると、レンタル（台月）や保守点検（ヶ月）の数量を工期に合わせて直します。
            </p>
            <h2 className="font-bold mb-2">1. 新しい現場の条件を入れる</h2>
            <QuoteConditionsForm value={query} onChange={setQuery} />
            <div className="flex items-center gap-3 mt-2 text-xs">
              <button type="button" className="text-gray-600 hover:underline" onClick={() => setQuery(EMPTY_CONDITIONS)}>
                条件をクリア
              </button>
              <Link href="/dashboard/material-prices/cases" className="text-blue-600 hover:underline">
                過去の見積りを登録・条件を直す
              </Link>
            </div>

            <h3 className="font-bold text-sm mt-4 mb-2">{hasQuery ? "条件の近い見積り" : "最近の見積り（条件を入れると近い順に並びます）"}</h3>
            {casesError && <p className="text-sm text-red-600">{casesError}</p>}
            {caseInfos === null && !casesError && <p className="text-sm text-gray-500">見積り事例を読み込み中...</p>}
            {caseInfos !== null && caseInfos.length === 0 && (
              <p className="text-sm text-gray-600">
                まだ過去の見積りが登録されていません。
                <Link href="/dashboard/material-prices/cases" className="text-blue-600 hover:underline">見積り事例</Link>
                で最終版の見積りExcelを登録してください。
              </p>
            )}
            <div className="space-y-2">
              {ranked.map((r) => {
                const c = r.quoteCase;
                const isBase = baseCase?.id === c.id;
                return (
                  <div key={c.id} className={`border rounded-lg p-3 ${isBase ? "border-green-500 bg-green-50/50" : ""}`}>
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="font-bold text-sm">
                          {hasQuery && <span className="text-green-700 mr-2">近さ {Math.round(r.score * 100)}%</span>}
                          {c.title}
                        </div>
                        <div className="text-xs text-gray-600">
                          {c.quoteDate ?? "日付不明"} ／ {c.client || "宛先なし"} ／ 税抜 {yen(c.subtotal)}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
                        disabled={!index || loadingCaseId !== null}
                        onClick={() => loadCase(c)}
                      >
                        {loadingCaseId === c.id ? "読み込み中..." : isBase ? "もう一度読み込む" : "この見積りを元にする"}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {hasQuery
                        ? r.reasons.map((x, i) => (
                            <span key={i} className={`rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${MATCH_STYLES[x.level]}`}>
                              {x.label} {x.value}
                            </span>
                          ))
                        : conditionParts(c).map((part, i) => (
                            <span key={i} className="bg-gray-100 rounded px-1.5 py-0.5 text-xs whitespace-nowrap">{part}</span>
                          ))}
                    </div>
                    {c.note && <p className="text-xs text-gray-600 mt-1">{c.note}</p>}
                  </div>
                );
              })}
            </div>
            {caseInfos !== null && caseInfos.length > 3 && (
              <button type="button" className="text-sm text-blue-600 hover:underline mt-2" onClick={() => setShowMoreCases((v) => !v)}>
                {showMoreCases ? "上位3件だけ表示" : "もっと見る（10件まで）"}
              </button>
            )}
            {baseCase && (
              <p className="text-sm text-green-700 mt-3">「{baseCase.title}」（{baseCase.quoteDate ?? "日付不明"}）を元に下書きを作りました。下で内容を直してください。</p>
            )}
          </>
        )}
        <p className="text-xs text-gray-500 mt-3">
          {priceError ? <span className="text-red-600">{priceError}</span> : index ? `単価表 ${priceCount.toLocaleString("ja-JP")}件を読み込み済み` : "単価表を読み込み中..."}
        </p>
        {warnings.map((w, i) => (
          <p key={i} className="text-sm text-orange-700 mt-1">・{w}</p>
        ))}
      </section>

      {groups.length > 0 && (
        <>
          {/* 2. 表紙 */}
          <section id="quote-cover" className="bg-white border rounded-lg p-4 mb-4">
            <h2 className="font-bold mb-2">2. 表紙の内容</h2>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="text-sm">
                宛先（〇〇 御中）
                <SuggestInput
                  className={`${input} w-full`}
                  value={cover.client}
                  options={clientOpts}
                  onChange={(v) => setCover((c) => ({ ...c, client: v }))}
                  placeholder="過去の宛先から選ぶか、入力"
                />
              </label>
              <label className="text-sm">
                件名
                <input className={`${input} w-full`} value={cover.title} onChange={(e) => setCover({ ...cover, title: e.target.value })} />
              </label>
              <label className="text-sm">
                見積日
                <input type="date" className={`${input} w-full`} value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="text-sm md:row-span-2">
                自社情報（右上の6行：住所・社名・電話・取引銀行・口座・登録番号）
                <textarea
                  rows={6}
                  className={`${input} w-full font-mono`}
                  value={cover.companyLines.join("\n")}
                  onChange={(e) => setCover({ ...cover, companyLines: e.target.value.split("\n") })}
                />
              </label>
            </div>
          </section>

          {/* 3. 内訳 */}
          <section className="bg-white border rounded-lg p-4 mb-4">
            <h2 className="font-bold mb-2">3. 内訳を確認・編集</h2>
            <div className="flex flex-wrap gap-2 text-sm mb-3">
              <span className={missingCount > 0 ? "text-red-700 font-bold" : "text-gray-600"}>単価なし {missingCount}件</span>
              <span className={staleCount > 0 ? "text-orange-700 font-bold" : "text-gray-600"}>要確認（古い単価） {staleCount}件</span>
              <span className={specMismatchCount > 0 ? "text-amber-700 font-bold" : "text-gray-600"}>規格違いで当てた単価 {specMismatchCount}件</span>
              {caseCount > 0 && <span className="text-orange-700 font-bold">単価表になく元の見積りの単価 {caseCount}件</span>}
            </div>
            <p className="text-xs text-gray-500 mb-1">
              区分・名称・規格・単位・数量・単価を直接直せます。名称と規格は、入力すると過去に使ったものから似た候補が出ます（候補にないものもそのまま入力できます）。
              単価を空にすると単価表（雑材料消耗品・返納整備費は自動計算）に戻ります。単価表にない品目は「候補」から似た品目の単価を選べます。
            </p>
            <p className="text-xs text-gray-500 mb-3">
              材料を入れると、過去の見積りで一緒に入っていた労務（例：電線→電源ケーブル配線）を「自動追加」で足します。いらなければ削除してください。
              材料の数量を変えると自動追加した労務の数量も変わります（労務を手で直した後は変わりません）。
            </p>
            {caseGroupsError && <p className="text-xs text-orange-700 mb-3">{caseGroupsError}</p>}
            <datalist id="quote-units">
              {UNITS.map((u) => <option key={u} value={u} />)}
            </datalist>

            {groups.map((g, gi) => {
              const calc = calcs[gi];
              return (
                <div key={g.id} className="mb-6">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-bold">{g.no}.</span>
                    <input
                      className={`${input} font-bold min-w-[16rem]`}
                      value={g.name}
                      placeholder="工事区分名"
                      onChange={(e) => setGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)))}
                    />
                    <span className="text-sm text-gray-600">計 {yen(calc.total)}</span>
                    <button type="button" className="text-xs text-red-600 hover:underline ml-auto" onClick={() => removeGroup(g)}>
                      この工事区分を削除
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-100 text-left">
                          <th className="p-1 border">区分</th>
                          <th className="p-1 border">名称</th>
                          <th className="p-1 border">規格</th>
                          <th className="p-1 border">単位</th>
                          <th className="p-1 border text-right">数量</th>
                          <th className="p-1 border text-right">単価</th>
                          <th className="p-1 border text-right">金額</th>
                          <th className="p-1 border">備考</th>
                          <th className="p-1 border">単価の出どころ</th>
                          <th className="p-1 border"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {calc.items.map((item) => {
                          const amount = item.qty !== null && item.unitPrice !== null ? item.qty * item.unitPrice : null;
                          const original = g.items.find((i) => i.id === item.id)!;
                          const suggestOpen = openSuggest === item.id;
                          const blank = isBlankItem(original);
                          return (
                            <tr
                              key={item.id}
                              className={blank ? "bg-blue-50/40" : item.unitPrice === null ? "bg-red-50" : item.auto ? "bg-purple-50/40" : original.link ? "bg-sky-50/60" : ""}
                            >
                              <td className="p-1 border text-xs text-gray-500 whitespace-nowrap">
                                {item.auto ? (
                                  SECTION_LABELS[item.section]
                                ) : (
                                  <select
                                    className="border rounded px-0.5 py-0.5 text-xs bg-white"
                                    value={original.section}
                                    onChange={(e) => setItemSection(g.id, item.id, e.target.value as Section)}
                                  >
                                    {SECTIONS.map((s) => (
                                      <option key={s} value={s}>{SECTION_LABELS[s]}</option>
                                    ))}
                                  </select>
                                )}
                              </td>
                              <td className="p-1 border min-w-[11rem]">
                                {item.auto ? (
                                  item.name
                                ) : (
                                  <SuggestInput
                                    className="w-full border rounded px-1"
                                    value={original.name}
                                    options={nameOpts[original.section]}
                                    placeholder="名称"
                                    autoFocus={focusItemId === item.id}
                                    onChange={(v) => updateItem(g.id, item.id, { name: v })}
                                    onCommit={(v, o, prev) => commitText(g.id, item.id, "name", v, o, prev)}
                                  />
                                )}
                                {original.link && (
                                  <span className="inline-block mt-0.5 px-1.5 rounded bg-sky-100 text-sky-800 text-xs whitespace-nowrap">
                                    {original.link.kind === "added" ? "自動追加" : "材料に合わせて変更"}
                                  </span>
                                )}
                              </td>
                              <td className="p-1 border min-w-[11rem] text-xs">
                                {item.auto ? (
                                  item.spec
                                ) : (
                                  <SuggestInput
                                    className="w-full border rounded px-1"
                                    value={original.spec}
                                    options={() => specOptions(catalog, original.section, original.name).map((o) => ({ value: displayText(o.spec), hint: o.unit }))}
                                    placeholder="規格"
                                    onChange={(v) => updateItem(g.id, item.id, { spec: v })}
                                    onCommit={(v, o, prev) => commitText(g.id, item.id, "spec", v, o, prev)}
                                  />
                                )}
                                {original.extraSpecs.map((s, i) => (
                                  <input
                                    key={i}
                                    className="w-full border rounded px-1 mt-0.5"
                                    value={s}
                                    onChange={(e) => updateItem(g.id, item.id, { extraSpecs: original.extraSpecs.map((x, j) => (j === i ? e.target.value : x)) })}
                                    onBlur={() => {
                                      if (!s.trim()) updateItem(g.id, item.id, { extraSpecs: original.extraSpecs.filter((_, j) => j !== i) });
                                    }}
                                  />
                                ))}
                              </td>
                              <td className="p-1 border whitespace-nowrap">
                                {item.auto ? (
                                  item.unit
                                ) : (
                                  <input
                                    className="w-14 border rounded px-1"
                                    list="quote-units"
                                    value={original.unit}
                                    onChange={(e) => updateItem(g.id, item.id, { unit: e.target.value })}
                                  />
                                )}
                              </td>
                              <td className="p-1 border text-right">
                                <input
                                  className="w-20 border rounded px-1 text-right"
                                  inputMode="decimal"
                                  value={item.qty ?? ""}
                                  onChange={(e) => setItemQty(g.id, original, e.target.value)}
                                />
                              </td>
                              <td className="p-1 border text-right">
                                <input
                                  className="w-24 border rounded px-1 text-right"
                                  inputMode="numeric"
                                  value={original.source === "auto" ? "" : num(item.unitPrice)}
                                  placeholder={original.source === "auto" ? num(item.unitPrice) : ""}
                                  onChange={(e) => setItemPrice(g.id, original, e.target.value)}
                                />
                              </td>
                              <td className="p-1 border text-right whitespace-nowrap">{amount === null ? "" : num(amount)}</td>
                              <td className="p-1 border min-w-[8rem] text-xs">
                                <SuggestInput
                                  className="w-full border rounded px-1"
                                  value={original.note}
                                  options={noteOpts}
                                  placeholder="備考"
                                  onChange={(v) => updateItem(g.id, item.id, { note: v })}
                                />
                              </td>
                              <td className="p-1 border">
                                {!blank && (
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <SourceBadge item={item} />
                                    {!item.auto && index && (
                                      <button
                                        type="button"
                                        className="text-xs text-blue-600 hover:underline"
                                        onClick={() => setOpenSuggest(suggestOpen ? null : item.id)}
                                      >
                                        候補
                                      </button>
                                    )}
                                  </div>
                                )}
                                {suggestOpen && index && (
                                  <div className="mt-1 border rounded bg-white shadow-sm max-h-48 overflow-y-auto">
                                    {suggestPrices(index, item).length === 0 && <p className="text-xs p-2 text-gray-500">似た品目が見つかりません</p>}
                                    {suggestPrices(index, item).map((c, i) => (
                                      <button
                                        key={i}
                                        type="button"
                                        className="block w-full text-left text-xs px-2 py-1 hover:bg-blue-50"
                                        onClick={() => pickCandidate(g.id, original, c)}
                                      >
                                        {c.name} {displayText(c.specification)} / {c.unit} <b>¥{c.unitPrice.toLocaleString("ja-JP")}</b>
                                        <span className="text-gray-500"> {c.category} {c.date ?? "日付不明"}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="p-1 border text-center">
                                <button
                                  type="button"
                                  className="text-xs text-red-600 hover:underline whitespace-nowrap"
                                  title="この行を削除"
                                  onClick={() => updateGroup(g.id, (x) => removeItem(x, item.id))}
                                >
                                  削除
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="bg-gray-50 text-xs">
                          <td className="p-1 border" colSpan={10}>
                            <div className="flex items-center gap-2 flex-wrap">
                              {SECTIONS.map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  className="border rounded px-2 py-0.5 bg-white hover:bg-blue-50 text-blue-700"
                                  onClick={() => addRow(g.id, s)}
                                >
                                  ＋ {SECTION_LABELS[s]}の行
                                </button>
                              ))}
                              <span className="ml-auto">
                                材料費 {yen(calc.materialSubtotal)} ／ 労務費 {yen(calc.laborSubtotal)}
                                {calc.otherTotal > 0 && ` ／ その他 ${yen(calc.otherTotal)}`}
                              </span>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 max-w-3xl">
                    <p className="text-xs text-gray-600 mb-1">
                      ※の注意書き（内訳の「{groups.length === 1 ? "合計" : `${g.no}. 計`}」の上に入ります）
                    </p>
                    <NoteLines
                      notes={g.notes}
                      placeholder="例：掘削埋戻しは別途"
                      onChange={(notes) => updateGroup(g.id, (x) => ({ ...x, notes }))}
                    />
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              className="text-sm border rounded px-3 py-1 hover:bg-gray-50"
              onClick={() => setGroups((gs) => renumber([...gs, blankGroup()]))}
            >
              ＋ 工事区分を追加
            </button>
          </section>

          {/* 4. 表紙の経費 */}
          <section className="bg-white border rounded-lg p-4 mb-4">
            <h2 className="font-bold mb-2">4. 表紙の経費と合計</h2>

            <h3 className="text-sm font-bold mt-2 mb-1">運搬費などの追加行</h3>
            <div className="overflow-x-auto">
              <table className="text-sm border-collapse mb-2">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="p-1 border">名称</th>
                    <th className="p-1 border">規格</th>
                    <th className="p-1 border">単位</th>
                    <th className="p-1 border">数量</th>
                    <th className="p-1 border">単価</th>
                    <th className="p-1 border">金額</th>
                    <th className="p-1 border"></th>
                  </tr>
                </thead>
                <tbody>
                  {extras.map((x) => (
                    <tr key={x.id}>
                      <td className="p-1 border"><input className="w-40 border rounded px-1" value={x.name} onChange={(e) => updateExtra(x.id, { name: e.target.value })} /></td>
                      <td className="p-1 border"><input className="w-32 border rounded px-1" value={x.spec} onChange={(e) => updateExtra(x.id, { spec: e.target.value })} /></td>
                      <td className="p-1 border"><input className="w-12 border rounded px-1" value={x.unit} onChange={(e) => updateExtra(x.id, { unit: e.target.value })} /></td>
                      <td className="p-1 border"><input className="w-16 border rounded px-1 text-right" inputMode="decimal" value={x.qty} onChange={(e) => updateExtra(x.id, { qty: Number(e.target.value) || 0 })} /></td>
                      <td className="p-1 border"><input className="w-24 border rounded px-1 text-right" inputMode="numeric" value={x.unitPrice} onChange={(e) => updateExtra(x.id, { unitPrice: Number(e.target.value.replace(/,/g, "")) || 0 })} /></td>
                      <td className="p-1 border text-right whitespace-nowrap">{num(x.qty * x.unitPrice)}</td>
                      <td className="p-1 border">
                        <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setExtras((xs) => xs.filter((y) => y.id !== x.id))}>
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {EXTRA_PRESETS.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  className="text-xs border rounded px-2 py-1 hover:bg-gray-50"
                  onClick={() => setExtras((xs) => [...xs, { id: newId("x"), ...p }])}
                >
                  ＋ {p.name}{p.spec && `（${p.spec}）`} ¥{p.unitPrice.toLocaleString("ja-JP")}/{p.unit}
                </button>
              ))}
              <button
                type="button"
                className="text-xs border rounded px-2 py-1 hover:bg-gray-50"
                onClick={() => setExtras((xs) => [...xs, { id: newId("x"), name: "", spec: "", unit: "式", qty: 1, unitPrice: 0 }])}
              >
                ＋ 空の行
              </button>
            </div>

            <h3 className="text-sm font-bold mt-2 mb-1">見積書の行と摘要</h3>
            <div className="overflow-x-auto">
              <table className="text-sm mb-3">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="pr-6 font-normal"></th>
                    <th className="text-right font-normal">金額</th>
                    <th className="pl-4 font-normal">摘要（見積書の右端の欄）</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g, i) => (
                    <tr key={g.id}>
                      <td className="pr-6 py-0.5">{g.no}. {g.name}</td>
                      <td className="text-right whitespace-nowrap">{yen(coverCalc.groupTotals[i])}</td>
                      <td className="pl-4 py-0.5">
                        <input className={`${input} w-56`} value={g.remark ?? ""} onChange={(e) => updateGroup(g.id, (x) => ({ ...x, remark: e.target.value }))} />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pr-6 py-0.5">撤去労務費 <span className="text-xs text-gray-500">（労務費 {yen(coverCalc.labor)} × {Math.round(settings.removalRate * 100)}%）</span></td>
                    <td className="text-right whitespace-nowrap">{yen(coverCalc.removal)}</td>
                    <td className="pl-4 py-0.5">
                      <input className={`${input} w-56`} value={fixedRemarks.removal} onChange={(e) => setFixedRemarks({ ...fixedRemarks, removal: e.target.value })} />
                    </td>
                  </tr>
                  {extras.map((x) => (
                    <tr key={x.id}>
                      <td className="pr-6 py-0.5">{x.name}</td>
                      <td className="text-right whitespace-nowrap">{yen(x.qty * x.unitPrice)}</td>
                      <td className="pl-4 py-0.5">
                        <input className={`${input} w-56`} value={x.remark ?? ""} onChange={(e) => updateExtra(x.id, { remark: e.target.value })} />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pr-6 py-0.5">諸経費 <span className="text-xs text-gray-500">（約{Math.round(settings.overheadRate * 100)}%、税抜小計を{coverCalc.roundUnit.toLocaleString("ja-JP")}円単位にそろえる）</span></td>
                    <td className="text-right whitespace-nowrap">{yen(coverCalc.overhead)}</td>
                    <td className="pl-4 py-0.5">
                      <input className={`${input} w-56`} value={fixedRemarks.overhead} onChange={(e) => setFixedRemarks({ ...fixedRemarks, overhead: e.target.value })} />
                    </td>
                  </tr>
                  <tr>
                    <td className="pr-6 py-0.5">法定福利費 <span className="text-xs text-gray-500">（労務費総額 {yen(coverCalc.welfareLabor)} × {(settings.welfareRate * 100).toFixed(2)}%）</span></td>
                    <td className="text-right whitespace-nowrap">{yen(coverCalc.welfare)}</td>
                    <td className="pl-4 py-0.5">
                      <input className={`${input} w-56`} value={fixedRemarks.welfare} onChange={(e) => setFixedRemarks({ ...fixedRemarks, welfare: e.target.value })} />
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="py-2">
                      <p className="text-xs text-gray-600 mb-1">※の注意書き（見積書の「10％対象 税抜小計」の上に入ります）</p>
                      <div className="max-w-3xl">
                        <NoteLines notes={coverNotes} placeholder="例：解体工事の見積りは別途" onChange={setCoverNotes} />
                      </div>
                    </td>
                  </tr>
                  <tr className="border-t">
                    <td className="pr-6 py-0.5 font-bold">税抜小計</td>
                    <td className="text-right font-bold whitespace-nowrap">{yen(coverCalc.subtotal)}</td>
                    <td></td>
                  </tr>
                  <tr>
                    <td className="pr-6 py-0.5">消費税</td>
                    <td className="text-right whitespace-nowrap">{yen(coverCalc.tax)}</td>
                    <td></td>
                  </tr>
                  <tr>
                    <td className="pr-6 py-0.5 font-bold text-lg">合計金額</td>
                    <td className="text-right font-bold text-lg whitespace-nowrap">{yen(coverCalc.total)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <button type="button" className="text-sm text-blue-600 hover:underline" onClick={() => setShowSettings((v) => !v)}>
              {showSettings ? "計算の設定を閉じる" : "計算の設定を変える"}
            </button>
            {showSettings && (
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 mt-3 text-sm">
                <label>雑材料消耗品（材料費の%）
                  <input className={`${input} w-full`} defaultValue={settings.miscRate * 100} onChange={(e) => setSetting("miscRate", e.target.value, true)} />
                </label>
                <label>工事区分の計をそろえる単位（円）
                  <select className={`${input} w-full`} value={settings.groupRoundUnit} onChange={(e) => setSetting("groupRoundUnit", e.target.value)}>
                    {[1, 100, 1000, 10000].map((u) => <option key={u} value={u}>{u.toLocaleString("ja-JP")}</option>)}
                  </select>
                </label>
                <label>撤去労務費（労務費の%）
                  <input className={`${input} w-full`} defaultValue={settings.removalRate * 100} onChange={(e) => setSetting("removalRate", e.target.value, true)} />
                </label>
                <label>撤去労務費を直接入力（空なら自動）
                  <input className={`${input} w-full`} inputMode="numeric" defaultValue={settings.removalOverride ?? ""} onChange={(e) => setSetting("removalOverride", e.target.value)} />
                </label>
                <label>法定福利費（%）
                  <input className={`${input} w-full`} defaultValue={settings.welfareRate * 100} onChange={(e) => setSetting("welfareRate", e.target.value, true)} />
                </label>
                <label>諸経費の目安（%）
                  <input className={`${input} w-full`} defaultValue={settings.overheadRate * 100} onChange={(e) => setSetting("overheadRate", e.target.value, true)} />
                </label>
                <label>税抜小計をそろえる単位（円）
                  <select className={`${input} w-full`} value={settings.subtotalRoundUnit} onChange={(e) => setSetting("subtotalRoundUnit", e.target.value)}>
                    <option value={0}>自動（500万円未満は1万円、以上は10万円）</option>
                    {[1000, 5000, 10000, 100000].map((u) => <option key={u} value={u}>{u.toLocaleString("ja-JP")}</option>)}
                  </select>
                </label>
                <label>諸経費を直接入力（空なら自動）
                  <input className={`${input} w-full`} inputMode="numeric" defaultValue={settings.overheadOverride ?? ""} onChange={(e) => setSetting("overheadOverride", e.target.value)} />
                </label>
                <label>この日数より古い単価は「要確認」
                  <input className={`${input} w-full`} inputMode="numeric" defaultValue={settings.staleDays} onChange={(e) => setSetting("staleDays", e.target.value)} />
                </label>
              </div>
            )}
          </section>

          <div className="flex items-center gap-3 mb-10">
            <button
              type="button"
              className="bg-green-600 text-white px-6 py-3 rounded hover:bg-green-700 disabled:opacity-50"
              disabled={downloading}
              onClick={handleDownload}
            >
              {downloading ? "作成中..." : "見積書Excelをダウンロード"}
            </button>
            <span className="text-sm text-gray-600">表紙「見積書」と「内訳」の2シートで作ります。</span>
          </div>
        </>
      )}
    </div>
  );
}

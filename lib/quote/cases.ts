// 見積り事例：過去の見積りに現場の条件を付けて保存し、条件の近い見積りを探して下書きにする
import * as XLSX from "xlsx";
import { withAutoItems } from "./calc";
import { cleanLabel, normKey } from "./normalize";
import { text as cellText, findHeader, newId, parseCoverSheet, parseDraftSheet, toNumber } from "./parseDraft";
import { applyPriceTable, type PriceIndex } from "./prices";
import type { AutoKind, CoverExtra, QuoteGroup, QuoteItem, Section } from "./types";

// 引込：電灯のみ / 動力のみ / 両方
export type ServiceKind = "" | "light" | "power" | "both";

export const SERVICE_KIND_LABELS: Record<Exclude<ServiceKind, "">, string> = {
  light: "電灯のみ",
  power: "動力のみ",
  both: "電灯＋動力",
};

export const WORK_TYPES = ["ハウス電源配線", "引込工事", "高圧受電", "その他"];
export const STRUCTURES = ["RC", "S", "SRC", "木造"];

export type CaseConditions = {
  workType: string;
  houseUnits: number | null; // 連棟数（シングル＝1）
  floors: number | null; // 階数（平屋＝1）
  buildings: number | null; // 棟数
  capacityKva: number | null; // 引込容量（kVA）
  serviceKind: ServiceKind;
  structure: string;
  floorArea: number | null; // 延床面積（㎡）
  siteArea: number | null; // 敷地面積（㎡）
  durationMonths: number | null; // 工期（月）
};

export const EMPTY_CONDITIONS: CaseConditions = {
  workType: "",
  houseUnits: null,
  floors: null,
  buildings: null,
  capacityKva: null,
  serviceKind: "",
  structure: "",
  floorArea: null,
  siteArea: null,
  durationMonths: null,
};

// 保存する内訳（画面用のidや単価の出どころは持たない）
export type CaseItem = {
  section: Section;
  name: string;
  spec: string;
  extraSpecs: string[];
  unit: string;
  qty: number | null;
  unitPrice: number | null;
  note: string;
  auto?: AutoKind;
};
export type CaseGroup = { name: string; spec: string; notes: string[]; items: CaseItem[] };
export type CaseExtra = { name: string; spec: string; unit: string; qty: number; unitPrice: number };

export type QuoteCaseInfo = CaseConditions & {
  id: string | null; // 未登録は null
  title: string;
  client: string;
  quoteDate: string | null; // YYYY-MM-DD
  sourceFile: string;
  subtotal: number; // 税抜小計
  note: string;
};

export type QuoteCase = QuoteCaseInfo & { groups: CaseGroup[]; extras: CaseExtra[] };

// ========== DB の行との変換 ==========

export const CASE_INFO_COLUMNS =
  "id, title, client, quote_date, source_file, work_type, house_units, floors, buildings, capacity_kva, service_kind, structure, floor_area, site_area, duration_months, subtotal, note";

export type QuoteCaseRow = {
  id: string;
  title: string;
  client: string;
  quote_date: string | null;
  source_file: string;
  work_type: string;
  house_units: number | null;
  floors: number | null;
  buildings: number | null;
  capacity_kva: number | string | null;
  service_kind: string;
  structure: string;
  floor_area: number | string | null;
  site_area: number | string | null;
  duration_months: number | string | null;
  subtotal: number | string;
  note: string;
  groups?: CaseGroup[];
  extras?: CaseExtra[];
};

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

export function caseFromRow(r: QuoteCaseRow): QuoteCase {
  const kind = ["light", "power", "both"].includes(r.service_kind) ? (r.service_kind as ServiceKind) : "";
  return {
    id: r.id,
    title: r.title ?? "",
    client: r.client ?? "",
    quoteDate: r.quote_date,
    sourceFile: r.source_file ?? "",
    workType: r.work_type ?? "",
    houseUnits: numOrNull(r.house_units),
    floors: numOrNull(r.floors),
    buildings: numOrNull(r.buildings),
    capacityKva: numOrNull(r.capacity_kva),
    serviceKind: kind,
    structure: r.structure ?? "",
    floorArea: numOrNull(r.floor_area),
    siteArea: numOrNull(r.site_area),
    durationMonths: numOrNull(r.duration_months),
    subtotal: numOrNull(r.subtotal) ?? 0,
    note: r.note ?? "",
    groups: Array.isArray(r.groups) ? r.groups : [],
    extras: Array.isArray(r.extras) ? r.extras : [],
  };
}

const intOrNull = (v: number | null) => (v === null ? null : Math.round(v));

export function caseInfoToRow(c: QuoteCaseInfo) {
  return {
    title: c.title,
    client: c.client,
    quote_date: c.quoteDate || null,
    source_file: c.sourceFile,
    work_type: c.workType.trim(),
    house_units: intOrNull(c.houseUnits),
    floors: intOrNull(c.floors),
    buildings: intOrNull(c.buildings),
    capacity_kva: c.capacityKva,
    service_kind: c.serviceKind,
    structure: c.structure.trim(),
    floor_area: c.floorArea,
    site_area: c.siteArea,
    duration_months: c.durationMonths,
    subtotal: Math.round(c.subtotal),
    note: c.note,
  };
}

export function caseToRow(c: QuoteCase) {
  return { ...caseInfoToRow(c), groups: c.groups, extras: c.extras };
}

// ========== 表示 ==========

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 2 });

export function conditionParts(c: CaseConditions): string[] {
  const parts: string[] = [];
  if (c.workType) parts.push(c.workType);
  if (c.houseUnits !== null || c.floors !== null) {
    const units = c.houseUnits === null ? "" : c.houseUnits === 1 ? "シングル" : `${fmt(c.houseUnits)}連棟`;
    const floors = c.floors === null ? "" : c.floors === 1 ? "平屋" : `${fmt(c.floors)}階建`;
    parts.push(units + floors);
  }
  if (c.buildings !== null) parts.push(`${fmt(c.buildings)}棟`);
  if (c.serviceKind) parts.push(SERVICE_KIND_LABELS[c.serviceKind]);
  if (c.capacityKva !== null) parts.push(`${fmt(c.capacityKva)}kVA`);
  if (c.structure) parts.push(/造$/.test(c.structure) ? c.structure : `${c.structure}造`);
  if (c.floorArea !== null) parts.push(`延床${fmt(c.floorArea)}㎡`);
  if (c.siteArea !== null) parts.push(`敷地${fmt(c.siteArea)}㎡`);
  if (c.durationMonths !== null) parts.push(`工期${fmt(c.durationMonths)}ヶ月`);
  return parts;
}

// ========== 過去の見積りExcel（最終版）の読み取り ==========

// 単位が月ごとのもの（レンタルの台月、保守点検・運搬費のヶ月）
export function isMonthUnit(unit: string): boolean {
  return /^(台月|[ヶケカか]月)$/.test(String(unit ?? "").normalize("NFKC").replace(/\s/g, "").replace(/ヵ/g, "カ"));
}

function dateFromFileName(fileName: string): string | null {
  const m = fileName.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.xlsx?$/i, "")
    .replace(/^\d{4}-\d{1,2}-\d{1,2}-?\s*/, "")
    .trim();
}

// 表紙の明細から、工事区分以外の行（運搬費・北電申請など）と税抜小計を読む
export function parseCoverLines(ws: XLSX.WorkSheet, groups: Pick<QuoteGroup, "name">[]): { extras: CaseExtra[]; subtotal: number | null } {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
  const { headerRow, cols } = findHeader(rows);
  const groupKeys = groups.map((g) => normKey(g.name)).filter(Boolean);
  const extras: CaseExtra[] = [];
  let subtotal: number | null = null;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const labels = row.map(cleanLabel);
    if (labels.some((l) => l.includes("税抜小計"))) {
      const nums = row.map(toNumber).filter((n): n is number => n !== null);
      if (nums.length > 0) subtotal = Math.round(nums[nums.length - 1]);
      break;
    }
    const name = cellText(row[cols.name]);
    const label = cleanLabel(name);
    if (!name || /撤去労務費|諸経費|法定福利費|消費税|小計|合計/.test(label)) continue;
    const key = normKey(name);
    if (groupKeys.some((g) => g === key)) continue;
    const qty = toNumber(row[cols.qty]);
    const price = toNumber(row[cols.price]);
    // 単価のない「式 1」の行は工事区分（名前が内訳と少し違うもの）
    if (qty === null || price === null || price <= 0) continue;
    extras.push({ name, spec: cellText(row[cols.spec]), unit: cellText(row[cols.unit]), qty, unitPrice: price });
  }
  return { extras, subtotal };
}

function toCaseGroups(groups: QuoteGroup[]): CaseGroup[] {
  return groups.map((g) => ({
    name: g.name,
    spec: g.spec,
    notes: g.notes,
    items: g.items.map((i) => ({
      section: i.section,
      name: i.name,
      spec: i.spec,
      extraSpecs: i.extraSpecs,
      unit: i.unit,
      qty: i.qty,
      unitPrice: i.unitPrice,
      note: i.note,
      ...(i.auto ? { auto: i.auto } : {}),
    })),
  }));
}

// 最終版の見積りExcel（表紙＋内訳）を読み、条件を推測した事例にする
export function parseCaseWorkbook(data: ArrayBuffer, fileName: string): { quoteCase: QuoteCase; warnings: string[] } {
  const wb = XLSX.read(data, { type: "array" });
  const names = wb.SheetNames;
  const sheetName =
    names.find((s) => s.includes("内訳") && !s.includes("悠介")) ?? names.find((s) => s.includes("内訳")) ?? names[0];
  const { groups, warnings } = parseDraftSheet(wb.Sheets[sheetName]);
  groups.forEach((g, i) => (g.no = String(i + 1)));
  if (groups.length === 0) warnings.push(`「${sheetName}」シートから品目を読み取れませんでした。`);
  if (sheetName.includes("悠介")) warnings.push(`最終版の内訳が見つからないため「${sheetName}」を読みました。単価が入っていない可能性があります。`);

  const coverName = names.find((s) => /見積書|表紙/.test(s) && !s.includes("悠介"));
  const cover = coverName ? parseCoverSheet(wb.Sheets[coverName]) : {};
  const { extras, subtotal } = coverName ? parseCoverLines(wb.Sheets[coverName], groups) : { extras: [], subtotal: null };
  if (!coverName) warnings.push("表紙（見積書）のシートが見つかりません。運搬費などの表紙の行は読み取れません。");

  const title = cover.title || titleFromFileName(fileName);
  const caseGroups = toCaseGroups(groups);
  const quoteCase: QuoteCase = {
    id: null,
    title,
    client: cover.client ?? "",
    quoteDate: dateFromFileName(fileName),
    sourceFile: fileName,
    subtotal: subtotal ?? 0,
    note: "",
    groups: caseGroups,
    extras,
    ...guessConditions(title, caseGroups, extras),
  };
  if (!quoteCase.quoteDate) warnings.push("ファイル名から見積日を読み取れませんでした（「2026-2-26-件名.xlsx」の形なら自動で入ります）。");
  return { quoteCase, warnings };
}

// ========== 条件の推測 ==========

const nf = (s: string) => String(s ?? "").normalize("NFKC").toUpperCase();

function mode(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  for (const [v, n] of counts) if (n > (counts.get(best) ?? 0) || (n === counts.get(best) && v > best)) best = v;
  return best;
}

function firstNumber(re: RegExp, ...texts: string[]): number | null {
  for (const t of texts) {
    const m = t.match(re);
    if (m) return parseFloat(m[1].replace(/,/g, ""));
  }
  return null;
}

// 件名・工事区分・品目の規格から条件を推測する（登録時に人が確認して直す前提）
export function guessConditions(title: string, groups: CaseGroup[], extras: CaseExtra[]): CaseConditions {
  const items = groups.flatMap((g) => g.items);
  const itemText = (i: CaseItem) => nf([i.name, i.spec, ...i.extraSpecs].join(" "));
  const head = nf(`${title} ${groups.map((g) => `${g.name} ${g.spec}`).join(" ")}`);
  const all = `${head} ${items.map(itemText).join(" ")} ${groups.flatMap((g) => g.notes).map(nf).join(" ")}`;

  const workType = /高圧|受電|キュービクル|キューピクル/.test(head)
    ? "高圧受電"
    : /引込/.test(head)
      ? "引込工事"
      : /ハウス/.test(head)
        ? "ハウス電源配線"
        : "";

  // ハウス（現場事務所）の大きさ：「シングル平屋」「13連棟2階建」など
  const houseItems = items.filter((i) => /ハウス/.test(nf(i.name)));
  const houseText = houseItems.map(itemText).join(" ");
  let houseUnits = firstNumber(/(\d+)\s*連棟/, houseText, head);
  if (houseUnits === null && /シングル/.test(houseText + head)) houseUnits = 1;
  let floors = firstNumber(/(\d+)\s*階建/, houseText, head);
  if (floors === null && /平屋/.test(houseText + head)) floors = 1;
  const buildingQty = houseItems.filter((i) => nf(i.unit) === "棟" && i.qty !== null).reduce((t, i) => t + (i.qty ?? 0), 0);
  const buildings = buildingQty > 0 ? buildingQty : null;

  // 引込容量：「SB4KVA契約」「主開閉器8KVA契約」「21KW契約」の合計。高圧はトランスの容量の合計
  let capacityKva: number | null = null;
  const contracts = [...all.matchAll(/(\d+(?:\.\d+)?)\s*K(?:VA|W)\s*契約/g)].map((m) => parseFloat(m[1]));
  if (contracts.length > 0) {
    capacityKva = contracts.reduce((t, v) => t + v, 0);
  } else if (workType === "高圧受電") {
    const trans = items.filter((i) => /トランス|変圧器/.test(i.name));
    let sum = 0;
    for (const t of trans) {
      const m = itemText(t).match(/(\d+(?:\.\d+)?)\s*KVA(?:\s*X\s*(\d+))?/);
      if (m) sum += parseFloat(m[1]) * (m[2] ? parseInt(m[2], 10) : 1);
    }
    if (sum > 0) capacityKva = sum;
  }

  // 電灯・動力：引込・受電の工事区分の中の言葉から
  const incoming = groups
    .filter((g) => /引込|受電/.test(nf(g.name)))
    .map((g) => `${nf(g.name)} ${nf(g.spec)} ${g.items.map(itemText).join(" ")}`)
    .join(" ");
  const hasLight = /電灯/.test(incoming) || /SB\s*\d/.test(incoming);
  const hasPower = /動力/.test(incoming);
  const serviceKind: ServiceKind = hasLight && hasPower ? "both" : hasLight ? "light" : hasPower ? "power" : "";

  const structure = /SRC造/.test(all) ? "SRC" : /RC造/.test(all) ? "RC" : /(^|[^A-Z])S造|鉄骨造/.test(all) ? "S" : /木造/.test(all) ? "木造" : "";
  const floorArea = firstNumber(/延床(?:面積)?\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*(?:M2|平米)/, all);
  const siteArea = firstNumber(/敷地(?:面積)?\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*(?:M2|平米)/, all);

  // 工期：レンタル（台月）・保守点検（ヶ月）の数量で一番多いもの
  const months = [...items, ...extras]
    .filter((i) => isMonthUnit(i.unit) && i.qty !== null && i.qty > 0)
    .map((i) => i.qty as number);
  const durationMonths = mode(months);

  return { workType, houseUnits, floors, buildings, capacityKva, serviceKind, structure, floorArea, siteArea, durationMonths };
}

// ========== 似た見積りを探す ==========

export type MatchLevel = "same" | "near" | "diff" | "unknown";
export type MatchReason = { label: string; value: string; level: MatchLevel };
export type RankedCase<T extends QuoteCaseInfo = QuoteCaseInfo> = { quoteCase: T; score: number; reasons: MatchReason[] };

type NumKey = "houseUnits" | "floors" | "buildings" | "capacityKva" | "floorArea" | "siteArea" | "durationMonths";

const NUMERIC_FIELDS: { key: NumKey; label: string; weight: number; unit: string }[] = [
  { key: "houseUnits", label: "連棟数", weight: 2, unit: "連棟" },
  { key: "floors", label: "階数", weight: 1.5, unit: "階" },
  { key: "buildings", label: "棟数", weight: 1, unit: "棟" },
  { key: "capacityKva", label: "引込容量", weight: 2, unit: "kVA" },
  { key: "floorArea", label: "延床面積", weight: 2, unit: "㎡" },
  { key: "siteArea", label: "敷地面積", weight: 1, unit: "㎡" },
  { key: "durationMonths", label: "工期", weight: 1, unit: "ヶ月" },
];

// 情報のない事例は「少しだけ近い」扱い（条件が入っている事例を優先する）
const UNKNOWN_SIMILARITY = 0.3;

export function rankCases<T extends QuoteCaseInfo>(query: CaseConditions, cases: T[], limit = 3): RankedCase<T>[] {
  const ranked = cases.map((c) => {
    let total = 0;
    let weight = 0;
    const reasons: MatchReason[] = [];
    const add = (label: string, value: string, w: number, sim: number, level: MatchLevel) => {
      total += w * sim;
      weight += w;
      reasons.push({ label, value, level });
    };

    const wt = query.workType.trim();
    if (wt) {
      if (!c.workType) add("工事種類", "未入力", 3, UNKNOWN_SIMILARITY, "unknown");
      else if (c.workType === wt) add("工事種類", c.workType, 3, 1, "same");
      else add("工事種類", c.workType, 3, 0, "diff");
    }
    if (query.serviceKind) {
      if (!c.serviceKind) add("電灯/動力", "未入力", 2, UNKNOWN_SIMILARITY, "unknown");
      else if (c.serviceKind === query.serviceKind) add("電灯/動力", SERVICE_KIND_LABELS[c.serviceKind], 2, 1, "same");
      else if (c.serviceKind === "both" || query.serviceKind === "both") add("電灯/動力", SERVICE_KIND_LABELS[c.serviceKind], 2, 0.5, "near");
      else add("電灯/動力", SERVICE_KIND_LABELS[c.serviceKind], 2, 0, "diff");
    }
    if (query.structure.trim()) {
      if (!c.structure) add("構造", "未入力", 1.5, UNKNOWN_SIMILARITY, "unknown");
      else if (normKey(c.structure).replace(/造$/, "") === normKey(query.structure).replace(/造$/, "")) add("構造", c.structure, 1.5, 1, "same");
      else add("構造", c.structure, 1.5, 0, "diff");
    }
    for (const f of NUMERIC_FIELDS) {
      const q = query[f.key];
      if (q === null) continue;
      const v = c[f.key];
      if (v === null) {
        add(f.label, "未入力", f.weight, UNKNOWN_SIMILARITY, "unknown");
        continue;
      }
      const sim = q === v ? 1 : q <= 0 || v <= 0 ? 0 : Math.min(q, v) / Math.max(q, v);
      add(f.label, `${fmt(v)}${f.unit}`, f.weight, sim, sim === 1 ? "same" : sim >= 0.7 ? "near" : "diff");
    }
    return { quoteCase: c, score: weight > 0 ? total / weight : 0, reasons };
  });

  return ranked
    .sort((a, b) => b.score - a.score || (b.quoteCase.quoteDate ?? "").localeCompare(a.quoteCase.quoteDate ?? ""))
    .slice(0, limit);
}

// ========== 事例から下書きを作る ==========

export type DraftFromCase = { groups: QuoteGroup[]; extras: CoverExtra[]; messages: string[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

// 品目・数量をコピーし、単価は単価表の最新に当て直す（単価表にない品目は元の見積りの単価）。
// 工期を入れた時は、台月・ヶ月の数量を工期の比率で直す
export function draftFromCase(
  c: QuoteCase,
  index: PriceIndex | null,
  opts: { durationMonths: number | null; staleDays: number; today?: Date },
): DraftFromCase {
  const messages: string[] = [];
  const factor = opts.durationMonths && c.durationMonths ? opts.durationMonths / c.durationMonths : null;
  let adjusted = 0;
  const adjustQty = (unit: string, qty: number | null) => {
    if (factor === null || factor === 1 || qty === null || !isMonthUnit(unit)) return qty;
    adjusted += 1;
    return round2(qty * factor);
  };
  const source = c.sourceFile || c.title;

  const groups: QuoteGroup[] = c.groups.map((g, gi) => {
    const items: QuoteItem[] = g.items.map((i) => ({
      id: newId("i"),
      section: i.section,
      name: i.name,
      spec: i.spec,
      extraSpecs: [...(i.extraSpecs ?? [])],
      unit: i.unit,
      qty: adjustQty(i.unit, i.qty),
      unitPrice: null,
      source: i.auto ? "auto" : "none",
      priceDate: null,
      priceFile: "",
      priceSpec: "",
      stale: false,
      note: i.note ?? "",
      ...(i.auto ? { auto: i.auto } : {}),
      ...(!i.auto && i.unitPrice !== null && i.unitPrice > 0
        ? { fallback: { unitPrice: i.unitPrice, date: c.quoteDate, file: source } }
        : {}),
    }));
    const group = withAutoItems({ id: newId("g"), no: String(gi + 1), name: g.name, spec: g.spec, items, notes: [...(g.notes ?? [])] });
    return index ? { ...group, items: applyPriceTable(group.items, index, opts.staleDays, opts.today) } : group;
  });

  const extras: CoverExtra[] = c.extras.map((x) => ({
    id: newId("x"),
    name: x.name,
    spec: x.spec,
    unit: x.unit,
    qty: adjustQty(x.unit, x.qty) ?? 0,
    unitPrice: x.unitPrice,
  }));

  if (factor !== null && factor !== 1 && adjusted > 0) {
    messages.push(`台月・ヶ月の数量（${adjusted}行）を、工期 ${fmt(c.durationMonths!)}ヶ月 → ${fmt(opts.durationMonths!)}ヶ月 に合わせて直しました。`);
  } else if (opts.durationMonths && !c.durationMonths && [...c.groups.flatMap((g) => g.items), ...c.extras].some((i) => isMonthUnit(i.unit))) {
    messages.push("元の見積りに工期が入っていないため、台月・ヶ月の数量はそのままです。");
  }
  return { groups, extras, messages };
}

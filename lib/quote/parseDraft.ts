import * as XLSX from "xlsx";
import { cleanLabel, displayText } from "./normalize";
import type { CoverInfo, QuoteGroup, QuoteItem, Section } from "./types";

export type ParsedDraft = {
  groups: QuoteGroup[];
  cover: Partial<CoverInfo>;
  warnings: string[];
};

let seq = 0;
export function newId(prefix = "q"): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

// 下書きに使うシートを選ぶ：「悠介」を含む内訳 → 他の内訳 → 先頭のシート
export function pickDraftSheet(sheetNames: string[]): string {
  return (
    sheetNames.find((s) => s.includes("内訳") && s.includes("悠介")) ??
    sheetNames.find((s) => s.includes("内訳")) ??
    sheetNames[0]
  );
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return isNaN(value) ? null : value;
  const s = String(value ?? "").normalize("NFKC").replace(/[¥,\s円]/g, "");
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return parseFloat(s);
}

function text(value: unknown): string {
  return displayText(String(value ?? "").trim());
}

type Columns = { no: number; name: number; spec: number; unit: number; qty: number; price: number; note: number };

const HEADER_LABELS: [keyof Columns, string[]][] = [
  ["no", ["番号"]],
  ["name", ["名称"]],
  ["spec", ["規格"]],
  ["unit", ["単位"]],
  ["qty", ["数量"]],
  ["price", ["単価"]],
  ["note", ["備考", "摘要"]],
];

// 見出し行（番号・名称・規格…）を探して列の位置を決める。見つからなければ A〜H 列の標準配置
function findHeader(rows: unknown[][]): { headerRow: number; cols: Columns } {
  const defaults: Columns = { no: 0, name: 1, spec: 2, unit: 3, qty: 4, price: 5, note: 7 };
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const labels = (rows[r] ?? []).map(cleanLabel);
    const nameCol = labels.indexOf("名称");
    if (nameCol < 0) continue;
    const cols = { ...defaults };
    for (const [k, names] of HEADER_LABELS) {
      const idx = labels.findIndex((l) => names.includes(l));
      if (idx >= 0) cols[k] = idx;
    }
    return { headerRow: r, cols };
  }
  return { headerRow: 1, cols: defaults };
}

// 「内訳 (悠介さん)」形式の下書き（品目と数量）を読み取る
export function parseDraftSheet(ws: XLSX.WorkSheet): { groups: QuoteGroup[]; warnings: string[] } {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
  const { headerRow, cols } = findHeader(rows);
  const groups: QuoteGroup[] = [];
  const warnings: string[] = [];
  let group: QuoteGroup | null = null;
  let section: Section = "other";
  let lastItem: QuoteItem | null = null;

  const ensureGroup = () => {
    if (!group) {
      group = { id: newId("g"), no: String(groups.length + 1), name: "", spec: "", items: [], notes: [] };
      groups.push(group);
      warnings.push("工事区分（番号付きの行）がないまま品目が始まっています。工事区分名を入力してください。");
    }
    return group;
  };

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const noRaw = row[cols.no];
    const name = text(row[cols.name]);
    const spec = text(row[cols.spec]);
    const unit = text(row[cols.unit]);
    const qty = toNumber(row[cols.qty]);
    const price = toNumber(row[cols.price]);
    const note = text(row[cols.note]);
    const label = cleanLabel(name);
    const noText = String(noRaw ?? "").trim();

    if (!name && !spec && qty === null && !note) continue;
    if (label === "内訳書") continue;

    // 工事区分の見出し（番号が入っている行）
    if (/^\d+$/.test(noText.normalize("NFKC")) && name) {
      group = { id: newId("g"), no: noText.normalize("NFKC"), name, spec, items: [], notes: [] };
      groups.push(group);
      section = "other";
      lastItem = null;
      continue;
    }

    if (qty === null && !unit) {
      if (label === "材料費") { section = "material"; lastItem = null; continue; }
      if (label === "労務費") { section = "labor"; lastItem = null; continue; }
      if (label.includes("小計")) { section = "other"; lastItem = null; continue; }
      if (label.includes("合計") || /^(\d+\.?)?計$/.test(label)) { lastItem = null; continue; }
    }

    // ※の注記
    if (noText === "※" || name.startsWith("※")) {
      const body = [name, spec].filter(Boolean).join("　");
      ensureGroup().notes.push(noText === "※" && !name.startsWith("※") ? `※${body}` : body);
      continue;
    }

    // 名称が空で規格だけの行は、前の品目の規格の続き
    if (!name && spec && qty === null) {
      if (lastItem) lastItem.extraSpecs.push(spec);
      continue;
    }

    // 数量も単位もない文章の行は注記として扱う
    if (name && qty === null && !unit && price === null) {
      ensureGroup().notes.push([name, spec].filter(Boolean).join("　"));
      continue;
    }

    if (!name) continue;

    const auto = label === "雑材料消耗品" ? "misc" : label.includes("返納整備費") ? "return" : undefined;
    const item: QuoteItem = {
      id: newId("i"),
      section,
      name,
      spec,
      extraSpecs: [],
      unit,
      qty,
      unitPrice: price !== null && price > 0 ? price : null,
      source: price !== null && price > 0 ? "draft" : auto ? "auto" : "none",
      priceDate: null,
      priceFile: "",
      priceSpec: "",
      stale: false,
      note,
      auto,
    };
    ensureGroup().items.push(item);
    lastItem = item;
  }

  return { groups, warnings };
}

// 表紙（見積書）シートから宛先・件名・自社情報を読み取る（前の見積りをコピーして作った場合）
export function parseCoverSheet(ws: XLSX.WorkSheet): Partial<CoverInfo> {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
  const cover: Partial<CoverInfo> = {};
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const label = cleanLabel(row[c]);
      if (label === "御中" && cover.client === undefined) {
        const left = row.slice(0, c).map((v) => text(v)).filter(Boolean);
        if (left.length > 0) cover.client = left[left.length - 1];
      }
      if (label.startsWith("件名") && cover.title === undefined) {
        const right = row.slice(c + 1).map((v) => text(v)).filter(Boolean);
        if (right.length > 0) cover.title = right[0];
      }
      if (label.startsWith("登録番号") && cover.companyLines === undefined) {
        // 登録番号の行から上に6行分（住所・社名・電話・取引銀行・口座・登録番号）
        const lines: string[] = [];
        for (let rr = Math.max(0, r - 6); rr <= r; rr++) {
          const v = String((rows[rr] ?? [])[c] ?? "");
          if (v.trim()) lines.push(v.replace(/\s+$/, ""));
        }
        if (lines.length > 0) cover.companyLines = lines;
      }
    }
  }
  return cover;
}

export function parseDraftWorkbook(data: ArrayBuffer, sheetName?: string): ParsedDraft & { sheetNames: string[]; sheetName: string } {
  const wb = XLSX.read(data, { type: "array" });
  const sheetNames = wb.SheetNames;
  const name = sheetName && sheetNames.includes(sheetName) ? sheetName : pickDraftSheet(sheetNames);
  const { groups, warnings } = parseDraftSheet(wb.Sheets[name]);

  const coverName = sheetNames.find((s) => /見積書|表紙/.test(s) && !s.includes("悠介")) ?? sheetNames.find((s) => /見積書|表紙/.test(s));
  const cover = coverName ? parseCoverSheet(wb.Sheets[coverName]) : {};

  if (groups.length === 0) warnings.push(`「${name}」シートから品目を読み取れませんでした。`);
  // 番号は表紙の並びと合うよう 1 から振り直す
  groups.forEach((g, i) => (g.no = String(i + 1)));
  return { groups, cover, warnings, sheetNames, sheetName: name };
}

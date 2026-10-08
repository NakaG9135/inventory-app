import type ExcelJS from "exceljs";
import { isBlankItem, type CoverCalc, type GroupCalc } from "./calc";
import { stripNoteMark } from "./normalize";
import type { CoverExtra, CoverInfo, FixedRemarks, QuoteGroup, QuoteItem, QuoteSettings } from "./types";

// 今までの見積書と同じ書式（表紙「見積書」＋「内訳」）のExcelを作る

const GOTHIC = "ＭＳ Ｐゴシック";
const MINCHO = "ＭＳ Ｐ明朝";
const NUM = "#,##0_);[Red](#,##0)";
const AMOUNT = "#,###";
const ROWS_PER_PAGE = 24; // 内訳の1ページあたりの行数（見出し2行を除く）
const MISSING_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2A8" } };

type Border = Partial<ExcelJS.Border> | undefined;
const thin: Partial<ExcelJS.Border> = { style: "thin" };
const medium: Partial<ExcelJS.Border> = { style: "medium" };
const hair: Partial<ExcelJS.Border> = { style: "hair" };

function setBorder(cell: ExcelJS.Cell, edges: { left?: Border; right?: Border; top?: Border; bottom?: Border }) {
  cell.border = { ...cell.border, ...Object.fromEntries(Object.entries(edges).filter(([, v]) => v !== undefined)) };
}

function qtyFormat(qty: number | null) {
  return qty !== null && !Number.isInteger(qty) ? "#,##0.0#" : NUM;
}

export type ExportInput = {
  cover: CoverInfo;
  date: Date;
  coverNotes: string[];
  fixedRemarks: FixedRemarks;
  groups: QuoteGroup[];
  calcs: GroupCalc[];
  extras: CoverExtra[];
  coverCalc: CoverCalc;
  settings: QuoteSettings;
};

// ---------------------------------------------------------------- 内訳
type DetailLine =
  | { kind: "header"; no: string; name: string; spec: string }
  | { kind: "label"; text: string }
  | { kind: "item"; item: QuoteItem }
  | { kind: "spec"; text: string }
  | { kind: "subtotal"; key: "material" | "labor" }
  | { kind: "note"; text: string }
  | { kind: "blank" }
  | { kind: "total"; label: string };

// 工事区分が1つだけの見積りは、過去の見積りと同じく「計」ではなく「合計」にする
function totalLabel(group: QuoteGroup, groupCount: number): string {
  return groupCount === 1 ? "【　　合　　計　　】" : `【　　${group.no}.　　計　　】`;
}

function detailLines(group: QuoteGroup, calc: GroupCalc, groupCount: number): DetailLine[] {
  const lines: DetailLine[] = [{ kind: "header", no: group.no, name: group.name, spec: group.spec }];
  const push = (items: QuoteItem[]) => {
    for (const item of items) {
      if (isBlankItem(item)) continue;
      lines.push({ kind: "item", item });
      for (const s of item.extraSpecs) lines.push({ kind: "spec", text: s });
    }
  };
  const materials = calc.items.filter((i) => i.section === "material");
  const labor = calc.items.filter((i) => i.section === "labor");
  const other = calc.items.filter((i) => i.section === "other");
  if (materials.length > 0) {
    lines.push({ kind: "label", text: "材料費" });
    push(materials);
    lines.push({ kind: "subtotal", key: "material" });
    if (labor.length > 0) lines.push({ kind: "blank" });
  }
  if (labor.length > 0) {
    lines.push({ kind: "label", text: "労務費" });
    push(labor);
    lines.push({ kind: "subtotal", key: "labor" });
  }
  if (other.length > 0) {
    if (materials.length + labor.length > 0) lines.push({ kind: "blank" });
    push(other);
  }
  // ※の注意書き（「計」の上）
  for (const n of group.notes) if (stripNoteMark(n).trim()) lines.push({ kind: "note", text: stripNoteMark(n).trim() });
  // 区分の計がページの最後の行に来るよう空行で埋める
  const used = lines.length + 1;
  const pages = Math.max(1, Math.ceil(used / ROWS_PER_PAGE));
  for (let i = used; i < pages * ROWS_PER_PAGE; i++) lines.push({ kind: "blank" });
  lines.push({ kind: "total", label: totalLabel(group, groupCount) });
  return lines;
}

// 戻り値：工事区分ごとの「計」のセル番地
function buildDetailSheet(wb: ExcelJS.Workbook, input: ExportInput): string[] {
  const ws = wb.addWorksheet("内訳", {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.59, right: 0.59, top: 0.39, bottom: 0.39, header: 0.51, footer: 0.51 },
      printTitlesRow: "1:2",
    },
  });
  const widths = [4.625, 26.625, 28.625, 6.625, 7.625, 9.625, 13.625, 16.625];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.mergeCells("A1:H1");
  const title = ws.getCell("A1");
  title.value = "内　　　訳　　　書";
  title.font = { name: GOTHIC, size: 16, bold: true };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 27;

  const headers = ["番号", "名　　　　　　称", "規　　　　　　格", "単位", "数量", "単　　価", "金　　額", "備　　考"];
  const hr = ws.getRow(2);
  hr.height = 24;
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { name: MINCHO, size: 11 };
    c.alignment = { horizontal: "center", vertical: "middle" };
    setBorder(c, { top: medium, bottom: thin, left: i === 0 ? medium : thin, right: i === 7 ? medium : thin });
  });

  const totals: string[] = [];
  let r = 3;
  input.groups.forEach((group, gi) => {
    const calc = input.calcs[gi];
    const lines = detailLines(group, calc, input.groups.length);
    const start = r;
    let sectionFirst = 0;
    const subtotalRows: number[] = [];
    const otherRows: number[] = [];

    for (const line of lines) {
      const row = ws.getRow(r);
      row.height = 18;
      for (let c = 1; c <= 8; c++) {
        const cell = row.getCell(c);
        cell.font = { name: MINCHO, size: 11, bold: c === 7 };
        cell.alignment = { vertical: "middle", horizontal: c === 1 || c === 4 ? "center" : c >= 5 && c <= 7 ? "right" : "left" };
        cell.numFmt = c === 7 ? AMOUNT : c >= 4 && c <= 6 ? NUM : "General";
        setBorder(cell, {
          left: c === 1 ? medium : thin,
          right: c === 8 ? medium : thin,
          top: r === start ? medium : hair,
          bottom: line.kind === "total" ? medium : hair,
        });
      }
      switch (line.kind) {
        case "header":
          row.getCell(1).value = Number(line.no) || line.no;
          row.getCell(2).value = line.name;
          row.getCell(3).value = line.spec || null;
          break;
        case "label":
          row.getCell(2).value = line.text;
          sectionFirst = r + 1;
          break;
        case "item": {
          const it = line.item;
          row.getCell(2).value = it.name;
          row.getCell(3).value = it.spec || null;
          row.getCell(4).value = it.unit || null;
          row.getCell(5).value = it.qty;
          row.getCell(5).numFmt = qtyFormat(it.qty);
          row.getCell(6).value = it.unitPrice;
          if (it.unitPrice === null) row.getCell(6).fill = MISSING_FILL;
          row.getCell(7).value = { formula: `E${r}*F${r}`, result: (it.qty ?? 0) * (it.unitPrice ?? 0) };
          row.getCell(8).value = it.note || null;
          if (it.section === "other") otherRows.push(r);
          break;
        }
        case "spec":
          row.getCell(3).value = line.text;
          break;
        case "subtotal": {
          row.getCell(2).value = "【　　小　　計　　】";
          const result = line.key === "material" ? calc.materialSubtotal : calc.laborSubtotal;
          row.getCell(7).value = { formula: `SUM(G${sectionFirst}:G${r - 1})`, result };
          subtotalRows.push(r);
          break;
        }
        case "note":
          row.getCell(1).value = "※";
          row.getCell(2).value = line.text;
          break;
        case "total": {
          row.getCell(2).value = line.label;
          const refs = [...subtotalRows, ...otherRows].map((x) => `G${x}`);
          row.getCell(7).value = { formula: refs.length > 0 ? refs.join("+") : "0", result: calc.total };
          totals.push(`G${r}`);
          row.addPageBreak();
          break;
        }
        case "blank":
          break;
      }
      r++;
    }
  });
  ws.pageSetup.printArea = `A1:H${r - 1}`;
  return totals;
}

// ---------------------------------------------------------------- 見積書（表紙）
function buildCoverSheet(wb: ExcelJS.Workbook, input: ExportInput, totals: string[]) {
  const ws = wb.addWorksheet("見積書", {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: { left: 0.59, right: 0.59, top: 0.59, bottom: 0.39, header: 0.51, footer: 0.51 },
    },
  });
  const widths = [4.625, 4.625, 12.625, 11.625, 4.625, 24.625, 6.625, 7.625, 10.625, 12.625, 10.625, 2.625];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const { cover, coverCalc: cc, settings } = input;
  const font = (size: number, extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: GOTHIC, size, ...extra });

  const put = (range: string, value: ExcelJS.CellValue, f: Partial<ExcelJS.Font>, align: Partial<ExcelJS.Alignment> = {}) => {
    if (range.includes(":")) ws.mergeCells(range);
    const cell = ws.getCell(range.split(":")[0]);
    cell.value = value;
    cell.font = f;
    cell.alignment = { vertical: "middle", ...align };
    return cell;
  };

  ws.getRow(1).height = 6;
  ws.getRow(2).height = 42;
  ws.getRow(3).height = 30;
  ws.getRow(4).height = 15;
  ws.getRow(5).height = 18;
  for (let i = 6; i <= 9; i++) ws.getRow(i).height = 21;

  put("E2:I2", "御　　見　　積　　書", font(20, { underline: true }), { horizontal: "center" });
  const d = input.date;
  const dateCell = put("J2:L2", new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), font(12, { underline: true }), { horizontal: "center" });
  dateCell.numFmt = 'yyyy"年"m"月"d"日"';
  put("A3:D3", cover.client, font(20, { bold: true }), { horizontal: "center", shrinkToFit: true });
  put("E3", "御中", font(18, { bold: true }), { horizontal: "left" });
  put("A4:B5", "件名：", font(16, { bold: true }), { horizontal: "center" });
  put("C4:H5", cover.title, font(16, { bold: true }), { horizontal: "left", wrapText: true, shrinkToFit: false });
  put("A6:F6", "　下　記　の　通　り　御　見　積　申　し　上　げ　ま　す。", font(11, { underline: true }));
  put("A7:C7", "見積有効期限：発行から3ヵ月", font(11, { underline: true }), { horizontal: "left", shrinkToFit: true });
  put("D7:D8", "合計金額", font(16, { bold: true }), { horizontal: "right" });

  const lines = [...cover.companyLines, "", "", "", "", "", ""].slice(0, 6);
  const fit = { shrinkToFit: true };
  put("I3:L3", lines[0], font(11), fit);
  put("I4:L5", lines[1], font(16, { bold: true }), { horizontal: "left", ...fit });
  put("I6:L6", lines[2], font(11), fit);
  put("I7:L7", lines[3], font(11), fit);
  put("I8:L8", lines[4], font(11), fit);
  put("I9:L9", lines[5], font(11), fit);

  // 見出し枠
  for (let c = 1; c <= 12; c++) setBorder(ws.getCell(2, c), { top: medium });
  for (let r = 2; r <= 9; r++) {
    setBorder(ws.getCell(r, 1), { left: medium });
    setBorder(ws.getCell(r, 12), { right: medium });
    setBorder(ws.getCell(r, 9), { left: medium });
  }
  for (let c = 1; c <= 5; c++) setBorder(ws.getCell(3, c), { bottom: medium });
  for (let c = 1; c <= 8; c++) setBorder(ws.getCell(5, c), { bottom: thin });
  for (let c = 4; c <= 8; c++) setBorder(ws.getCell(8, c), { bottom: medium });

  // 明細
  const head = ws.getRow(10);
  head.height = 27;
  const hdr: [string, string][] = [["A10", "番号"], ["B10:D10", "名　　　　　　　称"], ["E10:F10", "規　　　　　　格"], ["G10", "単位"], ["H10", "数　　量"], ["I10", "単　　価"], ["J10", "金　　額"], ["K10:L10", "摘要"]];
  for (const [range, text] of hdr) put(range, text, { name: MINCHO, size: 11 }, { horizontal: "center" });

  type CoverLine = { name: string; spec?: string; unit: string; qty: number; price?: number; amount: ExcelJS.CellValue; note?: string };
  const body: CoverLine[] = [];
  const fr = input.fixedRemarks;
  input.groups.forEach((g, i) => {
    body.push({ name: g.name, spec: g.spec, unit: "式", qty: 1, amount: { formula: `内訳!${totals[i]}`, result: cc.groupTotals[i] }, note: g.remark });
  });
  body.push({ name: "撤去労務費", unit: "式", qty: 1, amount: cc.removal, note: fr.removal });
  for (const e of input.extras) {
    body.push({ name: e.name, spec: e.spec, unit: e.unit, qty: e.qty, price: e.unitPrice, amount: null, note: e.remark });
  }
  body.push({ name: "諸経費", unit: "式", qty: 1, amount: cc.overhead, note: fr.overhead });
  const welfareIndex = body.length;
  body.push({ name: "法定福利費", unit: "式", qty: 1, amount: null, note: fr.welfare });

  let r = 11;
  const first = r;
  body.forEach((line, i) => {
    const row = ws.getRow(r);
    row.height = 21;
    ws.mergeCells(`B${r}:D${r}`);
    ws.mergeCells(`E${r}:F${r}`);
    ws.mergeCells(`K${r}:L${r}`);
    row.getCell(1).value = i + 1;
    row.getCell(2).value = line.name;
    row.getCell(5).value = line.spec || null;
    row.getCell(7).value = line.unit;
    row.getCell(8).value = line.qty;
    row.getCell(9).value = line.price ?? null;
    if (line.amount !== null) row.getCell(10).value = line.amount;
    else if (line.price !== undefined) row.getCell(10).value = { formula: `H${r}*I${r}`, result: line.qty * line.price };
    row.getCell(11).value = line.note?.trim() || null;
    r++;
  });

  // 注記：法定福利費の内訳（労務費総額 → 法定福利費は数式でつなぐ）
  const laborNoteRow = r + 1;
  const welfareRow = first + welfareIndex;
  ws.getCell(`J${welfareRow}`).value = {
    formula: `ROUND(B${laborNoteRow}*${settings.welfareRate},0)`,
    result: cc.welfare,
  };
  const ratePct = `${Math.round(settings.welfareRate * 10000) / 100}％`;
  const notes: { value: ExcelJS.CellValue; numFmt?: string; mark?: boolean }[] = [
    { value: { formula: `J${welfareRow}`, result: cc.welfare }, numFmt: '"見積金額には社会保険事業主負担である法定福利費"#,##0"円を含む。"' },
    { value: cc.welfareLabor, numFmt: `"（労務費総額"#,##0"円×社会保険加入率100％×社会保険料率${ratePct}）"` },
    { value: "本見積書は『「建設技能者の更なる処遇改善」に関わる見積提出要領』を理解・了解の上作成した。" },
    // ※の注意書き（税抜小計の上）。過去の見積りと同じくA列に※、B列に文章
    ...input.coverNotes.map(stripNoteMark).filter((n) => n.trim()).map((n) => ({ value: n.trim() as ExcelJS.CellValue, mark: true })),
  ];
  for (const n of notes) {
    ws.getRow(r).height = 21;
    ws.mergeCells(`B${r}:I${r}`);
    ws.mergeCells(`K${r}:L${r}`);
    const cell = ws.getCell(`B${r}`);
    cell.value = n.value;
    if (n.numFmt) cell.numFmt = n.numFmt;
    if (n.mark) ws.getCell(`A${r}`).value = "※";
    r++;
  }
  ws.getRow(r).height = 21;
  ws.mergeCells(`B${r}:D${r}`);
  ws.mergeCells(`K${r}:L${r}`);
  r++;

  const subRow = r;
  const summary: [string, ExcelJS.CellValue][] = [
    ["【 10％対象 税抜小計 】", { formula: `SUM(J${first}:J${subRow - 1})`, result: cc.subtotal }],
    ["【 10％対象 消費税 】", { formula: `ROUND(J${subRow}*${settings.taxRate},0)`, result: cc.tax }],
    ["【　　　合　　　計　 　 】", { formula: `J${subRow}+J${subRow + 1}`, result: cc.total }],
  ];
  for (const [label, value] of summary) {
    ws.getRow(r).height = 21;
    ws.mergeCells(`B${r}:D${r}`);
    ws.mergeCells(`E${r}:F${r}`);
    ws.mergeCells(`K${r}:L${r}`);
    ws.getCell(`B${r}`).value = label;
    ws.getCell(`J${r}`).value = value;
    r++;
  }
  const last = r - 1;

  // 表の書式と罫線
  const colStarts = [2, 5, 7, 8, 9, 10, 11];
  for (let rr = 10; rr <= last; rr++) {
    for (let c = 1; c <= 12; c++) {
      const cell = ws.getCell(rr, c);
      // 結合セルの2つ目以降に書式を入れると先頭セルの書式が上書きされるので、右端の罫線だけ先頭セルに付ける
      if (cell.isMerged && cell.master.address !== cell.address) {
        if (c === 12) setBorder(cell.master, { right: medium });
        continue;
      }
      if (rr > 10) {
        const isNote = rr >= first + body.length && rr < subRow;
        cell.font = { name: MINCHO, size: 11, bold: !isNote || c === 10 };
        const horizontal = c === 1 || c === 7 ? "center" : c === 8 || c === 9 || c === 10 ? "right" : "left";
        cell.alignment = { vertical: "middle", horizontal, shrinkToFit: c === 2 || c === 5 };
        if (c === 8 || c === 9) cell.numFmt = NUM;
        if (c === 10) cell.numFmt = AMOUNT;
      }
      setBorder(cell, {
        left: c === 1 ? medium : colStarts.includes(c) ? thin : undefined,
        right: c === 12 ? medium : undefined,
        top: rr === 10 ? medium : rr === 11 ? medium : hair,
        bottom: rr === last ? medium : hair,
      });
    }
  }

  const total = put("E7:H8", { formula: `J${last}`, result: cc.total }, font(18, { bold: true }), { horizontal: "center" });
  total.numFmt = '"¥"#,##0;"¥"\\-#,##0';
  ws.pageSetup.printArea = `A1:L${last}`;
}

export async function buildQuoteWorkbook(input: ExportInput): Promise<ArrayBuffer> {
  const ExcelJSModule = (await import("exceljs")).default;
  const wb = new ExcelJSModule.Workbook();
  wb.creator = "在庫管理アプリ";
  // 開いた時に数式を計算し直す（手直しした時も合計が合うように）
  wb.calcProperties.fullCalcOnLoad = true;
  // 表紙の数式は内訳の行番号を使うので、内訳を先に作ってから表紙を作り、並びは表紙を先頭にする
  const totals = buildDetailSheet(wb, input);
  buildCoverSheet(wb, input, totals);
  const cover = wb.getWorksheet("見積書");
  const detail = wb.getWorksheet("内訳");
  if (cover && detail) {
    // exceljs はシートを orderNo の順に書き出す（型定義には無いプロパティ）
    (cover as unknown as { orderNo: number }).orderNo = 0;
    (detail as unknown as { orderNo: number }).orderNo = 1;
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export function quoteFileName(date: Date, title: string): string {
  const safe = (title || "見積書").replace(/[\\/:*?"<>|]/g, "").trim();
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${safe}.xlsx`;
}

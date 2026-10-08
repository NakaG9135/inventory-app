import type ExcelJS from "exceljs";
import { isBlankItem, isMaintenance, type CoverCalc, type GroupCalc } from "./calc";
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

const BLANK: DetailLine = { kind: "blank" };

// 工事区分ごとにページ（ROWS_PER_PAGE 行）単位で並べる。過去の見積りと同じく、
// 1ページに収まらない時は材料費の小計をページの最後の行に置き、労務費は次のページから始める
function detailLines(group: QuoteGroup, calc: GroupCalc, groupCount: number): DetailLine[] {
  const rows = (items: QuoteItem[]): DetailLine[] =>
    items
      .filter((item) => !isBlankItem(item))
      .flatMap((item): DetailLine[] => [{ kind: "item", item }, ...item.extraSpecs.map((text): DetailLine => ({ kind: "spec", text }))]);
  const materials = calc.items.filter((i) => i.section === "material");
  const labor = calc.items.filter((i) => i.section === "labor");
  const other = calc.items.filter((i) => i.section === "other");
  const materialPart: DetailLine[] =
    materials.length > 0 ? [{ kind: "label", text: "材料費" }, ...rows(materials), { kind: "subtotal", key: "material" }] : [];
  const laborPart: DetailLine[] = labor.length > 0 ? [{ kind: "label", text: "労務費" }, ...rows(labor), { kind: "subtotal", key: "labor" }] : [];
  const otherPart = rows(other);
  const joined = (parts: DetailLine[][]) => parts.filter((p) => p.length > 0).flatMap((p, i) => (i > 0 ? [BLANK, ...p] : p));

  // ※の注意書きは「計」のすぐ上に下詰めで入れる
  const tail: DetailLine[] = [
    ...group.notes.map((n) => stripNoteMark(n).trim()).filter(Boolean).map((text): DetailLine => ({ kind: "note", text })),
    { kind: "total", label: totalLabel(group, groupCount) },
  ];
  const header: DetailLine = { kind: "header", no: group.no, name: group.name, spec: group.spec };
  let body = [header, ...joined([materialPart, laborPart, otherPart])];
  if (body.length + tail.length > ROWS_PER_PAGE && materialPart.length > 0 && laborPart.length + otherPart.length > 0) {
    const first = [header, ...materialPart];
    const fill = (ROWS_PER_PAGE - (first.length % ROWS_PER_PAGE)) % ROWS_PER_PAGE;
    first.splice(first.length - 1, 0, ...Array<DetailLine>(fill).fill(BLANK));
    body = [...first, ...joined([laborPart, otherPart])];
  }
  // 区分の計がページの最後の行に来るよう空行で埋める
  const used = body.length + tail.length;
  const pages = Math.max(1, Math.ceil(used / ROWS_PER_PAGE));
  return [...body, ...Array<DetailLine>(pages * ROWS_PER_PAGE - used).fill(BLANK), ...tail];
}

type DetailRefs = {
  // 工事区分ごとの「計」のセル番地
  totals: string[];
  // 労務費の合計（各区分の労務費の小計＋保守点検費）のセル番地。表紙右の計算欄の「労務費」はここを見る
  labor: string;
};

// 印刷設定・列幅・行の高さ・罫線は過去の見積り（A4横・120%・1ページ24行）に合わせる
function buildDetailSheet(wb: ExcelJS.Workbook, input: ExportInput): DetailRefs {
  const ws = wb.addWorksheet("内訳", {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      scale: 120,
      margins: { left: 0.59, right: 0.59, top: 0.39, bottom: 0.39, header: 0.51, footer: 0.51 },
      printTitlesRow: "1:2",
    },
  });
  const widths = [4.625, 26.625, 28.625, 6.625, 7.625, 9.625, 13.625, 16.625, 9, 10.875];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.mergeCells("A1:H1");
  const title = ws.getCell("A1");
  title.value = "内　　　訳　　　書";
  title.font = { name: GOTHIC, size: 18, bold: true };
  title.alignment = { horizontal: "center", vertical: "top" };
  ws.getRow(1).height = 27;

  const headers = ["番号", "名　　　　　　称", "規　　　　　　格", "単位", "数量", "単　　価", "金　　額", "備　　考"];
  const hr = ws.getRow(2);
  hr.height = 27;
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { name: MINCHO, size: 11 };
    c.alignment = { horizontal: "center", vertical: "middle" };
    setBorder(c, { top: medium, bottom: medium, left: i === 0 ? medium : thin, right: i === 7 ? medium : thin });
  });

  const totals: string[] = [];
  const laborRefs: string[] = [];
  let r = 3;
  input.groups.forEach((group, gi) => {
    const calc = input.calcs[gi];
    const lines = detailLines(group, calc, input.groups.length);
    let sectionFirst = 0;
    const subtotalRows: number[] = [];
    const otherRows: number[] = [];

    lines.forEach((line, li) => {
      const row = ws.getRow(r);
      row.height = 18;
      // ※の注意書きは名称と規格の欄をつなげて書く
      if (line.kind === "note") ws.mergeCells(`B${r}:C${r}`);
      for (let c = 1; c <= 8; c++) {
        if (line.kind === "note" && c === 3) continue;
        const cell = row.getCell(c);
        // 金額・備考と※の注意書きは太字
        cell.font = { name: MINCHO, size: 11, bold: c === 7 || c === 8 || line.kind === "note" };
        cell.alignment = {
          vertical: "middle",
          horizontal: c === 1 || c === 4 ? "center" : c >= 5 && c <= 7 ? "right" : "left",
          shrinkToFit: true,
        };
        cell.numFmt = c === 7 ? AMOUNT : c >= 4 && c <= 6 ? NUM : "General";
        // ページの最初と最後の行は太線（区分はページの頭から始まり、計はページの最後の行に来る）
        setBorder(cell, {
          left: c === 1 ? medium : thin,
          right: c === 8 ? medium : thin,
          top: li % ROWS_PER_PAGE === 0 ? medium : hair,
          bottom: (li + 1) % ROWS_PER_PAGE === 0 ? medium : hair,
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
          if (isMaintenance(it, group)) laborRefs.push(`G${r}`);
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
          if (line.key === "labor") laborRefs.push(`G${r}`);
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
          break;
        }
        case "blank":
          break;
      }
      r++;
    });
  });
  ws.pageSetup.printArea = `A1:H${r - 1}`;

  // 印刷範囲の外（J列）に労務費の合計。過去の見積りと同じ場所
  const laborTotal = input.calcs.reduce((t, c) => t + c.labor + c.maintenanceLabor, 0);
  ws.getCell("J3").value = "労務費";
  ws.getCell("J4").value = { formula: laborRefs.length > 0 ? laborRefs.join("+") : "0", result: laborTotal };
  for (const a of ["J3", "J4"]) ws.getCell(a).font = { name: MINCHO, size: 11 };
  ws.getCell("J4").numFmt = AMOUNT;
  return { totals, labor: "J4" };
}

// ---------------------------------------------------------------- 見積書（表紙）
// 印刷設定・列幅・行の高さは過去の見積り（A4横・120%）に合わせる
function buildCoverSheet(wb: ExcelJS.Workbook, input: ExportInput, detail: DetailRefs) {
  const { totals } = detail;
  const ws = wb.addWorksheet("見積書", {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      scale: 120,
      margins: { left: 0.59, right: 0.59, top: 0.59, bottom: 0.59, header: 0.51, footer: 0.51 },
      printTitlesRow: "10:10",
    },
  });
  // A〜L列が見積書、M〜P列は印刷しない計算欄
  const widths = [4.625, 4.625, 12.625, 10.625, 7.625, 20.625, 6.625, 8.625, 10.625, 13.625, 10.625, 2.625, 9, 9.75, 10.875, 13];
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

  [0.75, 42, 33, 18, 21, 21, 21, 21, 24].forEach((h, i) => (ws.getRow(i + 1).height = h));

  put("E2:I2", "御　　見　　積　　書", font(20, { underline: true }), { horizontal: "center" });
  const d = input.date;
  const dateCell = put("J2:L2", new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), font(12, { underline: true }), { horizontal: "center" });
  dateCell.numFmt = 'yyyy"年"m"月"d"日"';
  put("A3:D3", cover.client, font(20, { bold: true }), { horizontal: "center", shrinkToFit: true });
  put("E3", "御中", font(18, { bold: true }), { horizontal: "left" });
  put("A4:B5", "件名：", font(16, { bold: true }), { horizontal: "center" });
  put("C4:H5", cover.title, font(16, { bold: true }), { horizontal: "left", shrinkToFit: true });
  put("A6:F6", "　下　記　の　通　り　御　見　積　申　し　上　げ　ま　す。", font(11, { underline: true }));
  put("A7:C7", "見積有効期限：発行から3ヵ月", font(11, { underline: true }), { horizontal: "left", shrinkToFit: true });
  put("D7:D8", "合計金額", font(16, { bold: true }), { horizontal: "right", shrinkToFit: true });

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
  }
  for (let c = 1; c <= 5; c++) setBorder(ws.getCell(3, c), { bottom: medium });
  for (let c = 1; c <= 8; c++) setBorder(ws.getCell(5, c), { bottom: thin });
  for (let c = 4; c <= 8; c++) setBorder(ws.getCell(8, c), { bottom: medium });

  // 明細
  const head = ws.getRow(10);
  head.height = 30;
  const hdr: [string, string][] = [["A10", "番号"], ["B10:D10", "名　　　　　　　称"], ["E10:F10", "規　　　　　　格"], ["G10", "単位"], ["H10", "数　　量"], ["I10", "単　　価"], ["J10", "金　　額"], ["K10:L10", "摘要"]];
  for (const [range, text] of hdr) put(range, text, { name: MINCHO, size: 11 }, { horizontal: "center" });

  type CoverLine = { name: string; spec?: string; unit: string; qty: number; price?: number; amount: ExcelJS.CellValue; note?: string };
  const body: CoverLine[] = [];
  const fr = input.fixedRemarks;
  input.groups.forEach((g, i) => {
    body.push({ name: g.name, spec: g.spec, unit: "式", qty: 1, amount: { formula: `内訳!${totals[i]}`, result: cc.groupTotals[i] }, note: g.remark });
  });
  const removalIndex = body.length;
  body.push({ name: "撤去労務費", unit: "式", qty: 1, amount: cc.removal, note: fr.removal });
  for (const e of input.extras) {
    body.push({ name: e.name, spec: e.spec, unit: e.unit, qty: e.qty, price: e.unitPrice, amount: null, note: e.remark });
  }
  const overheadIndex = body.length;
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

  // 法定福利費は右の計算欄（N6）から取る
  const welfareRow = first + welfareIndex;
  ws.getCell(`J${welfareRow}`).value = { formula: "N6", result: cc.welfare };
  const ratePct = `${Math.round(settings.welfareRate * 10000) / 100}％`;
  type NoteLine = { value: ExcelJS.CellValue; numFmt?: string; mark?: boolean };
  const noteRow = (n: NoteLine | null) => {
    ws.getRow(r).height = 21;
    if (n) {
      ws.mergeCells(`B${r}:I${r}`);
      const cell = ws.getCell(`B${r}`);
      cell.value = n.value;
      if (n.numFmt) cell.numFmt = n.numFmt;
      if (n.mark) {
        ws.getCell(`A${r}`).value = "※";
        markRows.push(r);
      }
    } else {
      ws.mergeCells(`B${r}:D${r}`);
    }
    ws.mergeCells(`K${r}:L${r}`);
    r++;
  };
  const markRows: number[] = [];
  // 注記：法定福利費の内訳（労務費総額は右の計算欄の N5）
  noteRow({ value: { formula: `J${welfareRow}`, result: cc.welfare }, numFmt: '"見積金額には社会保険事業主負担である法定福利費"#,##0"円を含む。"' });
  noteRow({ value: { formula: "N5", result: cc.welfareLabor }, numFmt: `"（労務費総額"#,##0"円×社会保険加入率100％×社会保険料率${ratePct}）"` });
  noteRow({ value: "本見積書は『「建設技能者の更なる処遇改善」に関わる見積提出要領』を理解・了解の上作成した。" });
  noteRow(null);
  // ※の注意書きは税抜小計のすぐ上に下詰めで入れる。過去の見積りと同じくA列に※、B列に文章
  for (const n of input.coverNotes.map(stripNoteMark).filter((n) => n.trim())) noteRow({ value: n.trim(), mark: true });

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
        // 法定福利費などの決まった注記だけ細字、※の注意書きは太字
        const isNote = rr >= first + body.length && rr < subRow && !markRows.includes(rr);
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
        bottom: rr === 10 || rr === last ? medium : hair,
      });
    }
  }

  const total = put("E7:H8", { formula: `J${last}`, result: cc.total }, font(18, { bold: true }), { horizontal: "center" });
  total.numFmt = '"¥"#,##0;"¥"\\-#,##0';
  // 結合し直すと先に引いた下線が消えるので、合計金額の下線をもう一度引く
  setBorder(total, { bottom: medium });
  ws.pageSetup.printArea = `A1:L${last}`;

  // 右の計算欄（印刷範囲の外）。過去の見積りと同じ並びで、撤去費・諸経費を決める目安と法定福利費を数式で出す
  const removalRow = first + removalIndex;
  const overheadRow = first + overheadIndex;
  const dark: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFABF8F" } };
  const light: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE9D9" } };
  const side = (range: string, value: ExcelJS.CellValue, fill: ExcelJS.Fill | null, opts: { size?: number; align?: Partial<ExcelJS.Alignment> } = {}) => {
    if (range.includes(":")) ws.mergeCells(range);
    const cell = ws.getCell(range.split(":")[0]);
    cell.value = value;
    cell.font = { name: MINCHO, size: opts.size ?? 11 };
    if (opts.align) cell.alignment = opts.align;
    if (fill) cell.fill = fill;
    if (typeof value === "object" && value !== null) cell.numFmt = NUM;
  };
  const labor = cc.welfareLabor - cc.removal;
  const top: Partial<ExcelJS.Alignment> = { vertical: "top" };
  side("M2", "労務費", null);
  side("N2", { formula: `内訳!${detail.labor}`, result: labor }, dark);
  side("M3", `上記×${settings.removalRate}`, null, { size: 9, align: top });
  side("N3", { formula: `N2*${settings.removalRate}`, result: labor * settings.removalRate }, light, { size: 9, align: top });
  side("O3", "←調整して\n↓撤去費へ", light, { size: 10, align: { ...top, wrapText: true } });
  side("M4", "撤去費", null);
  side("N4", { formula: `J${removalRow}`, result: cc.removal }, dark);
  side("O4", "撤去費", dark);
  side("M5", "労務＋撤去", null, { align: { shrinkToFit: true } });
  side("N5", { formula: "N2+N4", result: cc.welfareLabor }, light);
  side("O5", "←労務費総額", light);
  side("M6", `上記×${settings.welfareRate}`, null, { align: { shrinkToFit: true } });
  side("N6", { formula: `ROUND(N5*${settings.welfareRate},0)`, result: cc.welfare }, dark);
  side("O6", "←法定福利費", dark);
  side("P6", null, dark);
  side("M7:M8", "法定福利\n以外の計", null, { align: { horizontal: "center", wrapText: true } });
  const nonWelfare = Array.from({ length: overheadRow - first }, (_, i) => `J${first + i}`).join("+");
  side("N7:N8", { formula: nonWelfare, result: cc.nonWelfareTotal }, light, { align: { horizontal: "right" } });
  side("O7:O8", null, light);
  side("P7:P8", null, light);
  side("M9", `上記×${settings.overheadRate}`, null);
  side("N9", { formula: `N7*${settings.overheadRate}`, result: cc.nonWelfareTotal * settings.overheadRate }, dark);
  side("O9", "←調整して諸経費へ", dark);
  side("P9", null, dark);
}

export async function buildQuoteWorkbook(input: ExportInput): Promise<ArrayBuffer> {
  const ExcelJSModule = (await import("exceljs")).default;
  const wb = new ExcelJSModule.Workbook();
  wb.creator = "在庫管理アプリ";
  // 開いた時に数式を計算し直す（手直しした時も合計が合うように）
  wb.calcProperties.fullCalcOnLoad = true;
  // 表紙の数式は内訳の行番号を使うので、内訳を先に作ってから表紙を作り、並びは表紙を先頭にする
  buildCoverSheet(wb, input, buildDetailSheet(wb, input));
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

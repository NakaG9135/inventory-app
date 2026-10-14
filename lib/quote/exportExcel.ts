import type ExcelJS from "exceljs";
import { isBlankItem, isMaintenance, type CoverCalc, type GroupCalc } from "./calc";
import { gaijiText, stripNoteMark } from "./normalize";
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

// 印刷範囲は過去の見積りと同じく $A$1:$H$42 の形で書く（exceljs は列の頭にだけ $ を付けるので、行の $ はこちらで付ける）
function absoluteArea(c1: string, r1: number, c2: string, r2: number) {
  return `${c1}$${r1}:${c2}$${r2}`;
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
  ws.pageSetup.printArea = absoluteArea("A", 1, "H", r - 1);

  // 印刷範囲の外（J列）に労務費の合計。過去の見積りと同じ場所
  const laborTotal = input.calcs.reduce((t, c) => t + c.labor + c.maintenanceLabor, 0);
  ws.getCell("J3").value = "労務費";
  ws.getCell("J4").value = { formula: laborRefs.length > 0 ? laborRefs.join("+") : "0", result: laborTotal };
  for (const a of ["J3", "J4"]) ws.getCell(a).font = { name: MINCHO, size: 11 };
  ws.getCell("J4").numFmt = AMOUNT;
  return { totals, labor: "J4" };
}

// ---------------------------------------------------------------- 見積書（表紙）
// 印刷設定・列幅・行の高さ・セルの書式は過去の見積り（A4横・120%）に合わせる。
// 列幅は注記の行（労務費総額…）がある見積り（2026-2-26 ほか）と同じ。E列は細く、規格は E:F を結合して使う
const COVER_WIDTHS = [4.625, 4.625, 12.625, 10.625, 4.625, 23.625, 6.625, 7.625, 10.625, 13.625, 11.625, 2.625, 9, 9.75, 10.875, 13];
// 見積日は過去の見積りと同じ和暦（令和8年10月14日）
const WAREKI_DATE = '[$-411]ggge"年"m"月"d"日"';

type CoverDrawing = { welfareNoteRow: number; ratePct: string };

function buildCoverSheet(wb: ExcelJS.Workbook, input: ExportInput, detail: DetailRefs): CoverDrawing {
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
  COVER_WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const { cover, coverCalc: cc, settings } = input;
  const font = (size: number, extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: GOTHIC, size, ...extra });

  // 縦位置を指定しないセルは過去の見積りと同じく下揃え
  const put = (range: string, value: ExcelJS.CellValue, f: Partial<ExcelJS.Font>, align: Partial<ExcelJS.Alignment> = {}) => {
    if (range.includes(":")) ws.mergeCells(range);
    const cell = ws.getCell(range.split(":")[0]);
    cell.value = value;
    cell.font = f;
    cell.alignment = align;
    return cell;
  };

  [0.75, 42, 33, 18, 21, 21, 21, 21, 24].forEach((h, i) => (ws.getRow(i + 1).height = h));

  put("E2:I2", " 御　　見　　積　　書 ", font(20, { underline: true }), { horizontal: "center" });
  const d = input.date;
  const dateCell = put("J2:L2", new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), font(12, { underline: true }), {
    horizontal: "center",
    vertical: "middle",
  });
  dateCell.numFmt = WAREKI_DATE;
  put("A3:D3", cover.client, font(20, { bold: true }), { horizontal: "center" });
  put("E3", "御中", font(18, { bold: true }), { horizontal: "left" });
  put("A4:B5", "　件名 ：", font(16, { bold: true }), { horizontal: "center" });
  put("C4:H5", cover.title, font(16, { bold: true }), { horizontal: "left", shrinkToFit: true });
  put("A6:F6", "　下　記　の　通　り　御　見　積　申　し　上　げ　ま　す。", font(11, { underline: true }));
  put("A7:C7", "見積有効期限：発行から3ヵ月", font(11, { underline: true }), { horizontal: "left", shrinkToFit: true });
  put("D7:D8", "合計金額", font(16, { bold: true }), { horizontal: "right", shrinkToFit: true });

  // 自社情報（住所・社名・電話・取引銀行・口座・登録番号）。行ごとの縦位置も過去の見積りと同じ
  const lines = [...cover.companyLines, "", "", "", "", "", ""].slice(0, 6);
  put("I3:L3", lines[0], font(11));
  put("I4:L5", lines[1], font(16, { bold: true }), { horizontal: "left", vertical: "middle" });
  put("I6:L6", lines[2], font(11), { vertical: "top" });
  put("I7:L7", lines[3], font(11), { vertical: "top" });
  put("I8:L8", lines[4], font(11), { vertical: "middle" });
  put("I9:L9", lines[5], font(11), { horizontal: "left", vertical: "top" });

  // 見出し枠（1行目は高さ0.75の細線、2行目から太線の枠）
  for (let c = 1; c <= 12; c++) setBorder(ws.getCell(1, c), { top: thin });
  setBorder(ws.getCell(1, 1), { left: thin });
  setBorder(ws.getCell(1, 12), { right: thin });
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
  for (const [range, text] of hdr) put(range, text, { name: MINCHO, size: 11 }, { horizontal: "center", vertical: "middle" });

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
  ws.getCell(`J${first + welfareIndex}`).value = { formula: "N6", result: cc.welfare };

  // 注記の行。cells は [列（結合する時は "B:H"）, 値, 表示形式]
  // fixed＝法定福利費の決まった注記（細字）、mark＝※の注意書き（太字）、blank＝空行
  type NoteKind = "fixed" | "mark" | "blank";
  const noteKinds = new Map<number, NoteKind>();
  const noteRow = (kind: NoteKind, cells: [string, ExcelJS.CellValue, string?][]) => {
    ws.getRow(r).height = 21;
    for (const [cols, value, numFmt] of cells) {
      const [c1, c2] = cols.split(":");
      if (c2) ws.mergeCells(`${c1}${r}:${c2}${r}`);
      const cell = ws.getCell(`${c1}${r}`);
      cell.value = value;
      if (numFmt) cell.numFmt = numFmt;
    }
    if (kind === "mark") ws.getCell(`A${r}`).value = "※";
    ws.mergeCells(`K${r}:L${r}`);
    noteKinds.set(r, kind);
    return r++;
  };
  // 過去の見積りと同じ3行。「×社会保険料率16.56%＝」は過去の見積りと同じくテキストボックスで重ねる（労務費総額は右の計算欄の N5）
  const ratePct = String(Math.round(settings.welfareRate * 10000) / 100);
  noteRow("fixed", [["B:H", { formula: "N6", result: cc.welfare }, '"見積金額には社会保険事業主負担である法定福利"#,##0"円を含む".']]);
  noteRow("fixed", [["B:I", "本見積書は『「建設技能者の更なる処遇改善」に関わる見積提出要領』を理解・了解の上作成した。"]]);
  const welfareNoteRow = noteRow("fixed", [
    ["B:F", { formula: "ROUND(N5,0)", result: Math.round(cc.welfareLabor) }, '"労務費総額"###\\×"社会保険加入率"\\100%'],
    ["G:H", { formula: "N6", result: cc.welfare }, '#,##0"円"'],
  ]);
  noteRow("blank", [["B:D", null], ["E:F", null]]);
  // ※の注意書きは税抜小計のすぐ上に下詰めで入れる。過去の見積りと同じくA列に※、B列に文章
  for (const n of input.coverNotes.map(stripNoteMark).filter((n) => n.trim())) noteRow("mark", [["B:I", n.trim()]]);

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

  // 表の書式と罫線（過去の見積りと同じく、A〜J列は縮小して全体を表示、縦は中央）
  const colStarts = [2, 5, 7, 8, 9, 10, 11];
  // 右端の線も過去の見積りと同じく、見出し・明細・合計の行は細線、注記・税抜小計・消費税の行は太線
  const frameRight = (rr: number) => (rr === 10 || rr === last || rr < first + body.length ? thin : medium);
  for (let rr = 10; rr <= last; rr++) {
    for (let c = 1; c <= 12; c++) {
      const cell = ws.getCell(rr, c);
      // 結合セルの2つ目以降に書式を入れると先頭セルの書式が上書きされるので、右端の罫線だけ先頭セルに付ける
      if (cell.isMerged && cell.master.address !== cell.address) {
        if (c === 12) setBorder(cell.master, { right: frameRight(rr) });
        continue;
      }
      if (rr > 10) {
        const kind = noteKinds.get(rr);
        const plainNote = kind === "fixed" || kind === "blank";
        // 法定福利費などの決まった注記は細字（金額・摘要の列は太字のまま）、※の注意書きは太字
        cell.font = { name: MINCHO, size: 11, bold: !plainNote || c >= 10 };
        const horizontal =
          c === 1 ? "center"
          : c === 10 ? "right"
          : c === 11 ? (plainNote ? "left" : "center")
          : plainNote ? "left"
          : c === 7 ? "center"
          : c === 8 || c === 9 ? "right"
          : "left";
        cell.alignment = { vertical: "middle", horizontal, shrinkToFit: c <= 10 || plainNote };
        if (!cell.numFmt) cell.numFmt = c === 7 || c === 9 ? NUM : c >= 10 ? AMOUNT : "General";
      }
      // 労務費総額の行は「×社会保険料率16.56%＝」のテキストボックスが重なるので、G列の左の線を引かない
      const noLine = rr === welfareNoteRow && c === 7;
      setBorder(cell, {
        left: c === 1 ? medium : colStarts.includes(c) && !noLine ? thin : undefined,
        right: c === 12 ? frameRight(rr) : undefined,
        top: rr === 10 ? medium : rr === 11 ? medium : hair,
        bottom: rr === 10 || rr === last ? medium : hair,
      });
    }
  }

  // 合計金額は過去の見積りと同じく太字の斜体・下揃え
  const total = put("E7:H8", { formula: `J${last}`, result: cc.total }, font(18, { bold: true, italic: true }), { horizontal: "center" });
  total.numFmt = '"¥"#,##0;"¥"\\-#,##0';
  // 結合し直すと先に引いた下線が消えるので、合計金額の下線をもう一度引く
  setBorder(total, { bottom: medium });
  ws.pageSetup.printArea = absoluteArea("A", 1, "L", last);

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

  return { welfareNoteRow, ratePct };
}

// ---------------------------------------------------------------- 図形（テキストボックス）
// exceljs は図形を書けないので、書き出した後にファイルの中身（xlsx は zip）へ直接足す。
// 位置は過去の見積りと同じ（セル基準のアンカー。列は0始まり、ずらし幅は EMU）
type Anchor = { col: number; colOff: number; row: number; rowOff: number };
const EMU_PER_PX = 9525;
const EMU_PER_PT = 12700;
const DIGIT_PX = 8; // 既定のフォント（ＭＳ Ｐゴシック 11）の数字の幅。列幅の文字数→ピクセルの換算に使う

function anchorPoint(widths: number[], heights: number[], a: Anchor) {
  let x = a.colOff;
  for (let c = 0; c < a.col; c++) x += Math.trunc(widths[c] * DIGIT_PX + 0.5) * EMU_PER_PX;
  let y = a.rowOff;
  for (let r = 0; r < a.row; r++) y += Math.round(heights[r] * EMU_PER_PT);
  return { x, y };
}

const anchorXml = (tag: "from" | "to", a: Anchor) =>
  `<xdr:${tag}><xdr:col>${a.col}</xdr:col><xdr:colOff>${a.colOff}</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>${a.rowOff}</xdr:rowOff></xdr:${tag}>`;

const xmlText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function textBoxXml(id: number, from: Anchor, to: Anchor, widths: number[], heights: number[], bodyPr: string, paragraph: string, style = "") {
  const p1 = anchorPoint(widths, heights, from);
  const p2 = anchorPoint(widths, heights, to);
  return (
    `<xdr:twoCellAnchor>${anchorXml("from", from)}${anchorXml("to", to)}` +
    `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="テキスト ボックス ${id - 1}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr>` +
    `<xdr:spPr><a:xfrm><a:off x="${p1.x}" y="${p1.y}"/><a:ext cx="${p2.x - p1.x}" cy="${p2.y - p1.y}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="9525" cmpd="sng"><a:noFill/></a:ln></xdr:spPr>${style}` +
    `<xdr:txBody>${bodyPr}<a:lstStyle/>${paragraph}</xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`
  );
}

// 見積書の図形：合計金額の右の「（税込）」と、注記の「×社会保険料率16.56%＝」
function coverDrawingXml(ws: ExcelJS.Worksheet, info: CoverDrawing): string {
  const widths = Array.from({ length: 16 }, (_, i) => ws.getColumn(i + 1).width ?? 9);
  const heights = Array.from({ length: info.welfareNoteRow + 2 }, (_, i) => ws.getRow(i + 1).height ?? 13.5);
  const gothic14b =
    `<a:rPr kumimoji="1" lang="ja-JP" altLang="en-US" sz="1400" b="1" i="0" u="none" strike="noStrike" kern="0" cap="none" spc="0" normalizeH="0" baseline="0" noProof="0">` +
    `<a:ln><a:noFill/></a:ln><a:solidFill><a:sysClr val="windowText" lastClr="000000"/></a:solidFill><a:effectLst/><a:uLnTx/><a:uFillTx/>` +
    `<a:latin typeface="Calibri" panose="020F0502020204030204"/><a:ea typeface="ＭＳ Ｐゴシック" panose="020B0600070205080204" pitchFamily="50" charset="-128"/><a:cs typeface="+mn-cs"/></a:rPr>`;
  const tax = textBoxXml(
    2,
    { col: 6, colOff: 123826, row: 6, rowOff: 228600 },
    { col: 7, colOff: 466726, row: 8, rowOff: 57150 },
    widths,
    heights,
    `<a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="square" rtlCol="0" anchor="t"/>`,
    `<a:p><a:pPr marL="0" marR="0" lvl="0" indent="0" defTabSz="914400" eaLnBrk="1" fontAlgn="auto" latinLnBrk="0" hangingPunct="1">` +
      `<a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft>` +
      `<a:buClrTx/><a:buSzTx/><a:buFontTx/><a:buNone/><a:tabLst/><a:defRPr/></a:pPr><a:r>${gothic14b}<a:t>（税込）</a:t></a:r></a:p>`,
  );
  const mincho = (lang: string) =>
    `<a:rPr kumimoji="1" lang="${lang}" altLang="${lang === "ja-JP" ? "en-US" : "ja-JP"}" sz="1100">` +
    `<a:latin typeface="ＭＳ Ｐ明朝" panose="02020600040205080304" pitchFamily="18" charset="-128"/>` +
    `<a:ea typeface="ＭＳ Ｐ明朝" panose="02020600040205080304" pitchFamily="18" charset="-128"/></a:rPr>`;
  const run = (lang: string, text: string) => `<a:r>${mincho(lang)}<a:t>${xmlText(text)}</a:t></a:r>`;
  // 注記の行（労務費総額…）の上下にまたがる高さで、F列の頭から G列の途中まで
  const row0 = info.welfareNoteRow - 1;
  const rate = textBoxXml(
    3,
    { col: 4, colOff: 342900, row: row0 - 1, rowOff: 219075 },
    { col: 6, colOff: 228600, row: row0 + 1, rowOff: 57150 },
    widths,
    heights,
    `<a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="square" rtlCol="0" anchor="ctr"/>`,
    `<a:p><a:pPr algn="ctr"/>${run("en-US", "×")}${run("ja-JP", "社会保険料率")}${run("en-US", `${info.ratePct}%`)}${run("ja-JP", "＝")}` +
      `<a:endParaRPr kumimoji="1" lang="en-US" altLang="ja-JP" sz="1100"><a:latin typeface="ＭＳ Ｐ明朝" panose="02020600040205080304" pitchFamily="18" charset="-128"/>` +
      `<a:ea typeface="ＭＳ Ｐ明朝" panose="02020600040205080304" pitchFamily="18" charset="-128"/></a:endParaRPr></a:p>`,
    `<xdr:style><a:lnRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef>` +
      `<a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="dk1"/></a:fontRef></xdr:style>`,
  );
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${tax}${rate}</xdr:wsDr>`
  );
}

const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

// 書き出したファイルに、①既定のフォントを過去の見積りと同じ ＭＳ Ｐゴシック 11 にする（列幅の見え方がこれで決まる）
// ②見積書シートに図形を足す
async function finishPackage(data: ArrayBuffer, sheetName: string, drawingXml: string): Promise<ArrayBuffer> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const read = async (path: string) => {
    const file = zip.file(path);
    if (!file) throw new Error(`Excelの作成に失敗しました（${path} がありません）`);
    return file.async("string");
  };

  const styles = await read("xl/styles.xml");
  zip.file(
    "xl/styles.xml",
    styles.replace(/(<fonts\b[^>]*>)<font>[\s\S]*?<\/font>/, `$1<font><sz val="11"/><name val="${GOTHIC}"/><family val="3"/><charset val="128"/></font>`),
  );

  const workbook = await read("xl/workbook.xml");
  const sheetTag = [...workbook.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => attrs(m[0])).find((a) => a.name === sheetName);
  const rels = await read("xl/_rels/workbook.xml.rels");
  const target = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => attrs(m[0])).find((a) => a.Id === sheetTag?.["r:id"])?.Target;
  if (!target) throw new Error(`Excelの作成に失敗しました（${sheetName} シートが見つかりません）`);
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const sheetRelsPath = sheetPath.replace(/([^/]+)$/, "_rels/$1.rels");

  let n = 1;
  while (zip.file(`xl/drawings/drawing${n}.xml`)) n++;
  const drawingPath = `xl/drawings/drawing${n}.xml`;
  zip.file(drawingPath, drawingXml);

  const relId = "rIdQuoteDrawing";
  const relXml = `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${n}.xml"/>`;
  const sheetRels = zip.file(sheetRelsPath)
    ? (await read(sheetRelsPath)).replace("</Relationships>", `${relXml}</Relationships>`)
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relXml}</Relationships>`;
  zip.file(sheetRelsPath, sheetRels);

  // <drawing> はシートの決まった位置（legacyDrawing・tableParts・extLst より前）に入れる
  const sheet = await read(sheetPath);
  const later = sheet.search(/<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/);
  const at = later >= 0 ? later : sheet.lastIndexOf("</worksheet>");
  zip.file(sheetPath, `${sheet.slice(0, at)}<drawing r:id="${relId}"/>${sheet.slice(at)}`);

  const types = await read("[Content_Types].xml");
  zip.file(
    "[Content_Types].xml",
    types.replace("</Types>", `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`),
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

export async function buildQuoteWorkbook(input: ExportInput): Promise<ArrayBuffer> {
  const ExcelJSModule = (await import("exceljs")).default;
  const wb = new ExcelJSModule.Workbook();
  wb.creator = "在庫管理アプリ";
  // 開いた時に数式を計算し直す（手直しした時も合計が合うように）
  wb.calcProperties.fullCalcOnLoad = true;
  // 表紙の数式は内訳の行番号を使うので、内訳を先に作ってから表紙を作り、並びは表紙を先頭にする
  const drawing = buildCoverSheet(wb, input, buildDetailSheet(wb, input));
  const cover = wb.getWorksheet("見積書");
  const detail = wb.getWorksheet("内訳");
  if (cover && detail) {
    // exceljs はシートを orderNo の順に書き出す（型定義には無いプロパティ）
    (cover as unknown as { orderNo: number }).orderNo = 0;
    (detail as unknown as { orderNo: number }).orderNo = 1;
  }
  for (const ws of [cover, detail]) {
    ws?.eachRow((row) =>
      row.eachCell((cell) => {
        if (typeof cell.value === "string" && cell.value.includes("㎟")) cell.value = gaijiText(cell.value);
      }),
    );
  }
  const data = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return cover ? finishPackage(data, cover.name, coverDrawingXml(cover, drawing)) : data;
}

export function quoteFileName(date: Date, title: string): string {
  const safe = (title || "見積書").replace(/[\\/:*?"<>|]/g, "").trim();
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${safe}.xlsx`;
}

import { newId } from "./parseDraft";
import type { CoverExtra, QuoteGroup, QuoteItem, QuoteSettings } from "./types";

// unit 単位に切り上げ（浮動小数の誤差で1円上がらないよう少し丸めてから）
export function ceilTo(value: number, unit: number): number {
  if (!(unit > 0)) return Math.round(value);
  return Math.ceil(Math.round(value * 100) / 100 / unit) * unit;
}

export function isRental(item: QuoteItem): boolean {
  return item.unit.replace(/\s/g, "") === "台月";
}

export function lineAmount(item: QuoteItem): number {
  if (item.qty === null || item.unitPrice === null) return 0;
  return item.qty * item.unitPrice;
}

// 自動計算の行（雑材料消耗品・返納整備費）が足りなければ追加する
export function withAutoItems(group: QuoteGroup): QuoteGroup {
  const items = [...group.items];
  const materials = items.filter((i) => i.section === "material");
  const blank = (over: Partial<QuoteItem>): QuoteItem => ({
    id: newId("i"),
    section: "material",
    name: "",
    spec: "",
    extraSpecs: [],
    unit: "式",
    qty: 1,
    unitPrice: null,
    source: "auto",
    priceDate: null,
    priceFile: "",
    priceSpec: "",
    stale: false,
    note: "",
    ...over,
  });

  // レンタル品（台月）があるのに返納整備費がなければ、最後のレンタル品の下に追加
  if (materials.some(isRental) && !items.some((i) => i.auto === "return")) {
    let last = -1;
    items.forEach((it, idx) => { if (it.section === "material" && isRental(it)) last = idx; });
    items.splice(last + 1, 0, blank({ name: "同上返納整備費", note: "使用料×5％", auto: "return" }));
  }
  // 材料があるのに雑材料消耗品がなければ、材料の最後に追加
  if (materials.some((i) => !i.auto && !isRental(i)) && !items.some((i) => i.auto === "misc")) {
    let last = -1;
    items.forEach((it, idx) => { if (it.section === "material") last = idx; });
    items.splice(last + 1, 0, blank({ name: "雑材料消耗品", auto: "misc" }));
  }
  return { ...group, items };
}

export type GroupCalc = {
  items: QuoteItem[]; // 自動計算の単価を入れたもの
  materialSubtotal: number;
  laborSubtotal: number;
  otherTotal: number;
  total: number;
  // 撤去費の基準になる労務費（労務費の小計）
  labor: number;
  // 法定福利費の基準に加える労務費（電気施設保守点検補修費など、区分外の保守費）
  maintenanceLabor: number;
};

export function calcGroup(group: QuoteGroup, s: QuoteSettings): GroupCalc {
  // 1. 返納整備費 = レンタル使用料 × 5%
  const rentalSum = group.items
    .filter((i) => i.section === "material" && isRental(i))
    .reduce((sum, i) => sum + lineAmount(i), 0);
  let items = group.items.map((i) =>
    i.auto === "return" && i.source === "auto"
      ? { ...i, qty: 1, unitPrice: Math.round(rentalSum * s.returnRate) }
      : i,
  );

  // 2. 雑材料消耗品 = 材料費（レンタル除く）の約3%。工事区分の計がキリの良い金額になるよう調整
  const misc = items.find((i) => i.auto === "misc");
  if (misc && misc.source === "auto") {
    const others = items.filter((i) => i !== misc);
    const base = others.reduce((sum, i) => sum + lineAmount(i), 0);
    const plainMaterial = others
      .filter((i) => i.section === "material" && !isRental(i) && !i.auto)
      .reduce((sum, i) => sum + lineAmount(i), 0);
    const target = ceilTo(base + plainMaterial * s.miscRate, s.groupRoundUnit);
    const value = Math.max(0, Math.round(target - base));
    items = items.map((i) => (i === misc ? { ...i, qty: 1, unitPrice: value } : i));
  }

  const sum = (pred: (i: QuoteItem) => boolean) => items.filter(pred).reduce((t, i) => t + lineAmount(i), 0);
  const materialSubtotal = sum((i) => i.section === "material");
  const laborSubtotal = sum((i) => i.section === "labor");
  const otherTotal = sum((i) => i.section === "other");
  const maintenanceLabor = sum((i) => i.section === "other" && /保守点検/.test(i.name + group.name));
  return {
    items,
    materialSubtotal,
    laborSubtotal,
    otherTotal,
    total: materialSubtotal + laborSubtotal + otherTotal,
    labor: laborSubtotal,
    maintenanceLabor,
  };
}

export type CoverCalc = {
  groupTotals: number[];
  labor: number; // 労務費（撤去費の基準）
  welfareLabor: number; // 労務費総額（労務費＋保守点検＋撤去費）
  removal: number;
  extrasTotal: number;
  nonWelfareTotal: number; // 法定福利費以外の計
  welfare: number;
  overhead: number;
  subtotal: number; // 税抜小計
  tax: number;
  total: number;
  roundUnit: number;
};

// 税抜小計を切り上げる単位（自動：500万円未満は1万円、以上は10万円）
export function autoRoundUnit(estimate: number): number {
  return estimate < 5_000_000 ? 10_000 : 100_000;
}

export function calcCover(groups: GroupCalc[], extras: CoverExtra[], s: QuoteSettings): CoverCalc {
  const groupTotals = groups.map((g) => g.total);
  const labor = groups.reduce((t, g) => t + g.labor, 0);
  const maintenance = groups.reduce((t, g) => t + g.maintenanceLabor, 0);

  // 撤去労務費 = 労務費 × 0.4 を千円単位に切り上げ
  const removal = s.removalOverride ?? ceilTo(labor * s.removalRate, s.removalRoundUnit);
  // 法定福利費 = （労務費＋撤去費）× 16.56%
  const welfareLabor = labor + maintenance + removal;
  const welfare = Math.round(welfareLabor * s.welfareRate);

  const extrasTotal = extras.reduce((t, e) => t + e.qty * e.unitPrice, 0);
  const nonWelfareTotal = groupTotals.reduce((t, v) => t + v, 0) + removal + extrasTotal;

  // 諸経費 = 法定福利費以外の計 × 10% を目安に、税抜小計がキリの良い金額になるよう調整
  const estimate = nonWelfareTotal * (1 + s.overheadRate) + welfare;
  const roundUnit = s.subtotalRoundUnit > 0 ? s.subtotalRoundUnit : autoRoundUnit(estimate);
  const overhead = s.overheadOverride ?? Math.max(0, ceilTo(estimate, roundUnit) - nonWelfareTotal - welfare);
  const subtotal = nonWelfareTotal + overhead + welfare;
  const tax = Math.round(subtotal * s.taxRate);
  return {
    groupTotals,
    labor,
    welfareLabor,
    removal,
    extrasTotal,
    nonWelfareTotal,
    welfare,
    overhead,
    subtotal,
    tax,
    total: subtotal + tax,
    roundUnit,
  };
}

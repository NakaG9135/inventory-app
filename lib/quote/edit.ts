// 内訳の行の追加・削除・区分の変更と、材料に合わせた労務の自動追加
import { withAutoItems } from "./calc";
import { findName, mainUnit, suggestLabor, type Catalog, type PairModel } from "./catalog";
import { normKey, normKeyLoose } from "./normalize";
import { newId } from "./parseDraft";
import { applyPriceTable, type PriceIndex } from "./prices";
import type { QuoteGroup, QuoteItem, Section } from "./types";

export function blankItem(section: Section, over: Partial<QuoteItem> = {}): QuoteItem {
  return {
    id: newId("i"),
    section,
    name: "",
    spec: "",
    extraSpecs: [],
    unit: "",
    qty: null,
    unitPrice: null,
    source: "none",
    priceDate: null,
    priceFile: "",
    priceSpec: "",
    stale: false,
    note: "",
    ...over,
  };
}

export function blankGroup(): QuoteGroup {
  return { id: newId("g"), no: "", name: "", spec: "", items: [], notes: [] };
}

export function renumber(groups: QuoteGroup[]): QuoteGroup[] {
  return groups.map((g, i) => (g.no === String(i + 1) ? g : { ...g, no: String(i + 1) }));
}

function lastIndex<T>(list: T[], pred: (v: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (pred(list[i])) return i;
  return -1;
}

// 区分のかたまり（材料費 → 労務費 → その他）の最後に入れる。材料は雑材料消耗品の上に入れる
export function insertInSection(items: QuoteItem[], item: QuoteItem): QuoteItem[] {
  const out = [...items];
  let at: number;
  if (item.section === "material") {
    const misc = out.findIndex((i) => i.auto === "misc");
    at = misc >= 0 ? misc : lastIndex(out, (i) => i.section === "material") + 1;
  } else if (item.section === "labor") {
    at = lastIndex(out, (i) => i.section === "material" || i.section === "labor") + 1;
  } else {
    at = out.length;
  }
  out.splice(at, 0, item);
  return out;
}

// 単価を当て直す。手入力の単価と自動計算の行はそのまま。
// 名称・規格を変えた時は、元にした見積りの単価（fallback）は別の品目のものなので使わない
export function reprice(item: QuoteItem, index: PriceIndex | null, staleDays: number, dropFallback: boolean): QuoteItem {
  if (item.auto || item.source === "manual") return item;
  const base: QuoteItem = { ...item, source: "none", unitPrice: null, priceDate: null, priceFile: "", priceSpec: "", stale: false };
  if (dropFallback) delete base.fallback;
  return index ? applyPriceTable([base], index, staleDays)[0] : base;
}

// 単位が空なら候補の単位を入れる（規格の単位 → 名称でよく使う単位）
export function fillUnit(item: QuoteItem, catalog: Catalog): QuoteItem {
  if (item.unit.trim()) return item;
  const entry = findName(catalog, item.section, item.name);
  const spec = entry?.specs.get(normKey(item.spec));
  const unit = spec?.unit || mainUnit(entry);
  return unit ? { ...item, unit } : item;
}

export function addItem(group: QuoteGroup, section: Section, id: string = newId("i")): { group: QuoteGroup; id: string } {
  const item = blankItem(section, { id });
  let next: QuoteGroup = { ...group, items: insertInSection(group.items, item) };
  // 材料の行を足した時、雑材料消耗品の行がなければ一緒に足す（新しく追加した工事区分など）
  if (section === "material") next = withAutoItems(next);
  return { group: next, id: item.id };
}

// 行を消す。材料を消した時は、その材料のために自動で足した労務（手で直していないもの）も消す
export function removeItem(group: QuoteGroup, id: string): QuoteGroup {
  return {
    ...group,
    items: group.items.filter((i) => i.id !== id && !(i.link?.from === id && i.link.kind === "added" && !i.link.touched)),
  };
}

export function changeSection(group: QuoteGroup, id: string, section: Section, index: PriceIndex | null, staleDays: number): QuoteGroup {
  const item = group.items.find((i) => i.id === id);
  if (!item || item.section === section) return group;
  const moved = reprice({ ...item, section, ...(item.link ? { link: { ...item.link, touched: true } } : {}) }, index, staleDays, false);
  return { ...group, items: insertInSection(group.items.filter((i) => i.id !== id), moved) };
}

// 材料の数量を変えた時、連動している労務の数量も合わせる
export function syncLinkedQty(group: QuoteGroup, materialId: string, qty: number | null): QuoteGroup {
  if (!group.items.some((i) => i.link?.from === materialId && i.link.sameQty && !i.link.touched)) return group;
  return {
    ...group,
    items: group.items.map((i) => (i.link?.from === materialId && i.link.sameQty && !i.link.touched ? { ...i, qty } : i)),
  };
}

const sameNameSpec = (a: { name: string; spec: string }, b: { name: string; spec: string }) =>
  normKey(a.name) === normKey(b.name) && normKeyLoose(a.spec) === normKeyLoose(b.spec);

export type CommitContext = { model: PairModel; index: PriceIndex | null; staleDays: number };

// 材料の名称・規格が決まった時に、一緒に入る労務を足す（または連動している労務を直す）。
// prev＝変更前の名称・規格（新しい行なら null）
export function commitMaterial(
  group: QuoteGroup,
  materialId: string,
  prev: { name: string; spec: string } | null,
  ctx: CommitContext,
): QuoteGroup {
  const material = group.items.find((i) => i.id === materialId);
  if (!material || material.section !== "material" || material.auto) return group;
  const sug = suggestLabor(ctx.model, material);
  const make = (base: QuoteItem, kind: "added" | "updated"): QuoteItem =>
    reprice(
      {
        ...base,
        name: sug!.name,
        spec: sug!.spec,
        extraSpecs: kind === "added" ? [] : base.extraSpecs,
        unit: sug!.unit || base.unit,
        qty: sug!.sameQty ? material.qty : base.qty,
        note: kind === "added" ? sug!.note : base.note,
        link: { from: material.id, kind, sameQty: sug!.sameQty, touched: false },
      },
      ctx.index,
      ctx.staleDays,
      true,
    );

  // すでに連動している労務がある：手で直していなければ新しい材料に合わせる（労務が要らない材料になったら消す）
  const linked = group.items.find((i) => i.link?.from === material.id);
  if (linked) {
    if (linked.link!.touched) return group;
    if (!sug) return linked.link!.kind === "added" ? { ...group, items: group.items.filter((i) => i.id !== linked.id) } : group;
    if (sameNameSpec(linked, sug)) return group;
    return { ...group, items: group.items.map((i) => (i.id === linked.id ? make(i, linked.link!.kind) : i)) };
  }
  if (!sug) return group;

  // 変更前の材料に対応していた労務が工事区分にあれば、それを新しい材料に合わせて直す
  const prevSug = prev && (prev.name !== material.name || prev.spec !== material.spec) ? suggestLabor(ctx.model, prev) : null;
  if (prevSug) {
    const counterpart = group.items.find((i) => i.section === "labor" && !i.link && sameNameSpec(i, prevSug));
    if (counterpart) {
      return { ...group, items: group.items.map((i) => (i.id === counterpart.id ? make(i, "updated") : i)) };
    }
  }
  // 同じ労務がもう入っていれば足さない
  if (group.items.some((i) => i.section === "labor" && sameNameSpec(i, sug))) return group;
  return { ...group, items: insertInSection(group.items, make(blankItem("labor"), "added")) };
}

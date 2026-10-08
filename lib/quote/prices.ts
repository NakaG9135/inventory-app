import { isFuzzyMatch } from "@/lib/fuzzyMatch";
import { normKey, normKeyLoose } from "./normalize";
import type { QuoteItem, Section } from "./types";

// material_prices の1行
export type PriceRow = {
  id: string;
  category: string;
  name: string;
  specification: string;
  unit: string;
  unit_price: number;
  source_file: string;
  created_at: string | null;
  updated_at: string | null;
};

export type PriceCandidate = {
  name: string;
  specification: string;
  unit: string;
  unitPrice: number;
  category: string;
  date: string | null; // YYYY-MM-DD
  sourceFile: string;
};

export type PriceIndex = {
  exact: Map<string, PriceCandidate[]>;
  loose: Map<string, PriceCandidate[]>;
  byName: Map<string, PriceCandidate[]>;
  all: PriceCandidate[];
};

export type PriceLookup = {
  candidate: PriceCandidate;
  stale: boolean;
  // 名称だけで当てた（規格違いだが単価表のどの規格も同じ単価）
  nameOnly: boolean;
};

const SECTION_CATEGORY: Record<Section, string> = {
  material: "材料費",
  labor: "労務費",
  other: "その他",
};

// 見積りの日付は取込元のファイル名（「2026-1-8-件名.xlsx [内訳]」）から取る。
// 手動追加の単価は登録・更新した日を使う
export function priceDate(row: Pick<PriceRow, "source_file" | "created_at" | "updated_at">): string | null {
  const m = String(row.source_file ?? "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (row.source_file === "手動追加") {
    const t = row.updated_at || row.created_at;
    return t ? t.slice(0, 10) : null;
  }
  return null;
}

function key(name: string, spec: string) {
  return `${normKey(name)}|${normKey(spec)}`;
}

function looseKey(name: string, spec: string) {
  return `${normKey(name)}|${normKeyLoose(spec)}`;
}

function push(map: Map<string, PriceCandidate[]>, k: string, c: PriceCandidate) {
  const list = map.get(k);
  if (list) list.push(c);
  else map.set(k, [c]);
}

export function buildPriceIndex(rows: PriceRow[]): PriceIndex {
  const index: PriceIndex = { exact: new Map(), loose: new Map(), byName: new Map(), all: [] };
  for (const r of rows) {
    const price = Number(r.unit_price);
    if (!r.name || !(price > 0)) continue;
    const c: PriceCandidate = {
      name: r.name,
      specification: r.specification ?? "",
      unit: r.unit ?? "",
      unitPrice: price,
      category: r.category ?? "",
      date: priceDate(r),
      sourceFile: r.source_file ?? "",
    };
    index.all.push(c);
    push(index.exact, key(c.name, c.specification), c);
    push(index.loose, looseKey(c.name, c.specification), c);
    push(index.byName, normKey(c.name), c);
  }
  return index;
}

// 一番新しい見積りの単価を選ぶ（日付不明は一番古い扱い。同じ日なら高い方）
function newest(list: PriceCandidate[]): PriceCandidate {
  return [...list].sort((a, b) => {
    const da = a.date ?? "";
    const db = b.date ?? "";
    if (da !== db) return da < db ? 1 : -1;
    return b.unitPrice - a.unitPrice;
  })[0];
}

// 同じ区分（材料費/労務費）の単価を優先する
function preferCategory(list: PriceCandidate[], section: Section): PriceCandidate[] {
  const same = list.filter((c) => c.category === SECTION_CATEGORY[section]);
  return same.length > 0 ? same : list;
}

export function isStale(date: string | null, staleDays: number, today: Date = new Date()): boolean {
  if (!date) return true;
  const t = new Date(`${date}T00:00:00`);
  if (isNaN(t.getTime())) return true;
  return (today.getTime() - t.getTime()) / 86400000 > staleDays;
}

export function lookupPrice(
  index: PriceIndex,
  item: Pick<QuoteItem, "name" | "spec" | "section">,
  staleDays: number,
  today?: Date,
): PriceLookup | null {
  const list = index.exact.get(key(item.name, item.spec)) ?? index.loose.get(looseKey(item.name, item.spec));
  if (list && list.length > 0) {
    const candidate = newest(preferCategory(list, item.section));
    return { candidate, stale: isStale(candidate.date, staleDays, today), nameOnly: false };
  }
  // 規格が一致しなくても、同じ名称の単価が（規格ごとの最新で）1種類しかなければそれを使う
  const byName = index.byName.get(normKey(item.name));
  if (!byName || byName.length === 0) return null;
  const perSpec = new Map<string, PriceCandidate[]>();
  for (const c of preferCategory(byName, item.section)) push(perSpec, normKey(c.specification), c);
  const latest = [...perSpec.values()].map(newest);
  if (new Set(latest.map((c) => c.unitPrice)).size !== 1) return null;
  const candidate = newest(latest);
  return { candidate, stale: isStale(candidate.date, staleDays, today), nameOnly: true };
}

// 単価表に見つからない時の候補（同じ名称の別規格・似た名称）。名称+規格ごとに最新の1件
export function suggestPrices(index: PriceIndex, item: Pick<QuoteItem, "name" | "spec" | "section">, limit = 10): PriceCandidate[] {
  const name = String(item.name ?? "").trim();
  if (!name) return [];
  const pool = new Map<string, PriceCandidate[]>();
  const add = (c: PriceCandidate) => push(pool, key(c.name, c.specification), c);

  for (const c of index.byName.get(normKey(name)) ?? []) add(c);
  if (pool.size < limit) {
    for (const c of index.all) {
      if (pool.size >= limit * 3) break;
      if (isFuzzyMatch(name, c.name)) add(c);
    }
  }
  const best = [...pool.values()].map((list) => newest(list));
  const sameCategory = SECTION_CATEGORY[item.section];
  best.sort((a, b) => {
    const ca = a.category === sameCategory ? 0 : 1;
    const cb = b.category === sameCategory ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return a.specification.localeCompare(b.specification, "ja");
  });
  return best.slice(0, limit);
}

// 単価が入っていない品目（と前回単価表から入れた品目）に、単価表の単価を当てはめる。
// 下書きに書いてあった単価・画面で手入力した単価・自動計算の行はそのまま
export function applyPriceTable(items: QuoteItem[], index: PriceIndex, staleDays: number, today?: Date): QuoteItem[] {
  return items.map((item) => {
    if (item.auto || item.source === "draft" || item.source === "manual" || item.source === "auto") return item;
    const hit = lookupPrice(index, item, staleDays, today);
    if (!hit) return { ...item, unitPrice: null, source: "none", priceDate: null, priceFile: "", priceSpec: "", stale: false };
    return {
      ...item,
      unitPrice: hit.candidate.unitPrice,
      source: "table",
      priceDate: hit.candidate.date,
      priceFile: hit.candidate.sourceFile,
      priceSpec: hit.nameOnly ? hit.candidate.specification || "（規格なし）" : "",
      stale: hit.stale,
    };
  });
}

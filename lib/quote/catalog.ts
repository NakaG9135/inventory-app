// 内訳の編集で使う候補（区分ごとの名称・名称ごとの規格）と、
// 材料を入れた時に一緒に入る労務を過去の見積りから推測する仕組み
import type { CaseGroup } from "./cases";
import { normKey, normKeyLoose } from "./normalize";
import type { PriceIndex } from "./prices";
import type { Section } from "./types";

const CATEGORY_SECTION: Record<string, Section> = { 材料費: "material", 労務費: "labor", その他: "other" };

export type SpecOption = { spec: string; unit: string; count: number };
export type NameOption = { name: string; count: number; units: Map<string, number>; specs: Map<string, SpecOption> };
export type Catalog = Record<Section, Map<string, NameOption>>;

function countUp(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function top<T>(map: Map<T, number>): T | null {
  let best: T | null = null;
  let n = -1;
  for (const [k, v] of map) if (v > n) [best, n] = [k, v];
  return best;
}

// 単価表（material_prices）と見積り事例の内訳から、区分ごとの名称・規格の候補を作る
export function buildCatalog(index: PriceIndex | null, caseGroups: CaseGroup[]): Catalog {
  const catalog: Catalog = { material: new Map(), labor: new Map(), other: new Map() };
  const add = (section: Section, name: string, spec: string, unit: string) => {
    const nk = normKey(name);
    if (!nk) return;
    let entry = catalog[section].get(nk);
    if (!entry) {
      entry = { name: name.trim(), count: 0, units: new Map(), specs: new Map() };
      catalog[section].set(nk, entry);
    }
    entry.count += 1;
    if (unit.trim()) countUp(entry.units, unit.trim());
    const sk = normKey(spec);
    if (!sk) return;
    const s = entry.specs.get(sk);
    if (s) s.count += 1;
    else entry.specs.set(sk, { spec: spec.trim(), unit: unit.trim(), count: 1 });
  };
  for (const c of index?.all ?? []) add(CATEGORY_SECTION[c.category] ?? "material", c.name, c.specification, c.unit);
  for (const g of caseGroups) {
    for (const i of g.items) if (!i.auto) add(i.section, i.name, i.spec, i.unit);
  }
  return catalog;
}

// よく使う順
export function nameOptions(catalog: Catalog, section: Section): NameOption[] {
  return [...catalog[section].values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));
}

// 名称に対する候補。その区分になければ他の区分の同じ名称から
export function findName(catalog: Catalog, section: Section, name: string): NameOption | null {
  const nk = normKey(name);
  if (!nk) return null;
  return (
    catalog[section].get(nk) ??
    (["material", "labor", "other"] as Section[]).map((s) => catalog[s].get(nk)).find((e) => e !== undefined) ??
    null
  );
}

export function specOptions(catalog: Catalog, section: Section, name: string): SpecOption[] {
  const entry = findName(catalog, section, name);
  if (!entry) return [];
  return [...entry.specs.values()].sort((a, b) => b.count - a.count || a.spec.localeCompare(b.spec, "ja"));
}

export function mainUnit(entry: NameOption | null): string {
  return entry ? (top(entry.units) ?? "") : "";
}

// ========== 備考 ==========

const DITTO = /^[〃″"]$/;

// 工事区分の中の行ごとの備考。「〃」は上の行と同じ備考として読む
function resolvedNotes(items: { note?: string }[]): string[] {
  let prev = "";
  return items.map((i) => {
    const n = String(i.note ?? "").trim();
    if (DITTO.test(n)) return prev;
    prev = n;
    return n;
  });
}

// 備考の候補（過去の見積りでよく使った順）
export function noteOptions(caseGroups: CaseGroup[], extra: string[] = []): string[] {
  const counts = new Map<string, number>();
  for (const g of caseGroups) {
    for (const i of g.items) {
      const n = String(i.note ?? "").trim();
      if (n && !i.auto) countUp(counts, n);
    }
  }
  for (const n of extra) if (!counts.has(n)) counts.set(n, 0);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).map(([n]) => n);
}

// ========== 材料 → 労務の組み合わせ ==========

type LaborStat = {
  name: string;
  count: number;
  sameQty: number; // 材料と同じ数量だった回数
  copySpec: number; // 材料と同じ規格だった回数
  specs: Map<string, number>;
  units: Map<string, number>;
};
type MaterialStat = { seen: number; labors: Map<string, LaborStat> };

export type PairModel = {
  byNameSpec: Map<string, MaterialStat>;
  byName: Map<string, MaterialStat>;
  // 労務の名称ごとの出てきた回数と備考の回数
  laborNotes: Map<string, { seen: number; notes: Map<string, number> }>;
};

export type LaborSuggestion = {
  name: string;
  spec: string;
  unit: string;
  // 材料と同じ数量にするか（過去に数量が違っていた組み合わせは空欄で入れる）
  sameQty: boolean;
  // 過去にその労務によく付いていた備考（掘削埋戻し別途など）
  note: string;
};

// 「電線 （解体用）」→「電線」
function baseName(name: string): string {
  return normKey(String(name ?? "").replace(/[（(][^（）()]*[）)]/g, ""));
}

// 労務の名称に含まれていれば同じ物とみなす語幹（「接地材」→「接地」、「支線材」→「支線」）
function stem(name: string): string {
  return baseName(name).replace(/(材料|材)$/, "");
}

function nameMatch(materialName: string, laborName: string): boolean {
  const s = stem(materialName);
  return s.length >= 2 && normKey(laborName).includes(s);
}

function specMatch(materialSpec: string, laborSpec: string): boolean {
  const a = normKeyLoose(materialSpec);
  const b = normKeyLoose(laborSpec);
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a));
}

function nameSpecKey(name: string, spec: string): string {
  return `${baseName(name)}|${normKeyLoose(spec)}`;
}

type PairItem = { section: Section; name: string; spec: string; unit: string; qty: number | null; auto?: unknown };

// 同じ工事区分に入っている材料と労務を組にする。
// 名称でつながる組（LED投光器→LED投光器取付配線）を先に取り、残った労務を規格でつなぐ（電線 CV38→電源ケーブル配線 CV38）
export function pairInGroup<T extends PairItem>(items: T[]): { material: T; labor: T | null }[] {
  const materials = items.filter((i) => i.section === "material" && !i.auto && normKey(i.name));
  const labors = items.filter((i) => i.section === "labor" && normKey(i.name));
  const claimed = new Set(labors.filter((l) => materials.some((m) => nameMatch(m.name, l.name))));
  return materials.map((m) => {
    let cands = labors.filter((l) => nameMatch(m.name, l.name));
    if (cands.length === 0) cands = labors.filter((l) => !claimed.has(l) && specMatch(m.spec, l.spec));
    if (cands.length === 0) return { material: m, labor: null };
    const best =
      cands.find((l) => l.qty === m.qty && specMatch(m.spec, l.spec)) ??
      cands.find((l) => l.qty === m.qty) ??
      cands.find((l) => specMatch(m.spec, l.spec)) ??
      cands[0];
    return { material: m, labor: best };
  });
}

function record(map: Map<string, MaterialStat>, key: string, material: PairItem, labor: PairItem | null) {
  let stat = map.get(key);
  if (!stat) {
    stat = { seen: 0, labors: new Map() };
    map.set(key, stat);
  }
  stat.seen += 1;
  if (!labor) return;
  const lk = normKey(labor.name);
  let l = stat.labors.get(lk);
  if (!l) {
    l = { name: labor.name.trim(), count: 0, sameQty: 0, copySpec: 0, specs: new Map(), units: new Map() };
    stat.labors.set(lk, l);
  }
  l.count += 1;
  if (material.qty !== null && labor.qty === material.qty) l.sameQty += 1;
  if (normKeyLoose(labor.spec) === normKeyLoose(material.spec)) l.copySpec += 1;
  countUp(l.specs, labor.spec.trim());
  if (labor.unit.trim()) countUp(l.units, labor.unit.trim());
}

export function learnPairs(caseGroups: CaseGroup[]): PairModel {
  const model: PairModel = { byNameSpec: new Map(), byName: new Map(), laborNotes: new Map() };
  for (const g of caseGroups) {
    const notes = resolvedNotes(g.items);
    g.items.forEach((i, idx) => {
      if (i.section !== "labor" || !normKey(i.name)) return;
      const k = normKey(i.name);
      let stat = model.laborNotes.get(k);
      if (!stat) {
        stat = { seen: 0, notes: new Map() };
        model.laborNotes.set(k, stat);
      }
      stat.seen += 1;
      if (notes[idx]) countUp(stat.notes, notes[idx]);
    });
    for (const { material, labor } of pairInGroup(g.items)) {
      record(model.byNameSpec, nameSpecKey(material.name, material.spec), material, labor);
      record(model.byName, baseName(material.name), material, labor);
    }
  }
  return model;
}

function bestLabor(stat: MaterialStat | undefined, minShare: number): LaborStat | null {
  if (!stat) return null;
  let best: LaborStat | null = null;
  for (const l of stat.labors.values()) if (!best || l.count > best.count) best = l;
  if (!best || best.count / stat.seen < minShare) return null;
  return best;
}

// 材料に対して一緒に入れる労務。名称＋規格で過去に出てきた材料はその結果に従い（労務なしも含む）、
// 初めての規格なら名称だけで判断する
export function suggestLabor(model: PairModel, material: { name: string; spec: string }): LaborSuggestion | null {
  if (!baseName(material.name)) return null;
  const exact = model.byNameSpec.get(nameSpecKey(material.name, material.spec));
  const l = exact ? bestLabor(exact, 0.5) : bestLabor(model.byName.get(baseName(material.name)), 0.25);
  if (!l) return null;
  // 規格：過去と同じ材料なら過去の労務の規格。初めての規格なら、材料の規格を写していた労務は写す
  const copy = exact ? l.copySpec * 2 >= l.count : l.copySpec > 0 || l.specs.size !== 1;
  return {
    name: l.name,
    spec: copy ? material.spec : (top(l.specs) ?? ""),
    unit: top(l.units) ?? "",
    sameQty: l.sameQty * 2 >= l.count,
    note: usualNote(model, l.name),
  };
}

// その労務に半分以上の見積りで付いていた備考
function usualNote(model: PairModel, laborName: string): string {
  const stat = model.laborNotes.get(normKey(laborName));
  if (!stat) return "";
  const note = top(stat.notes);
  return note && stat.notes.get(note)! * 2 >= stat.seen ? note : "";
}

// 見積り作成の画面で作った見積りを見積り事例（quote_cases）に保存し、あとで開いて直す
import { isBlankItem, type GroupCalc } from "./calc";
import {
  EMPTY_CONDITIONS,
  conditionParts,
  draftFromCase,
  guessConditions,
  type CaseConditions,
  type CaseExtra,
  type CaseGroup,
  type QuoteCase,
  type QuoteCaseInfo,
} from "./cases";
import {
  DEFAULT_SETTINGS,
  EMPTY_FIXED_REMARKS,
  type CoverExtra,
  type FixedRemarks,
  type QuoteGroup,
  type QuoteItem,
  type QuoteSettings,
} from "./types";

// 画面の中身（editor 列）。宛先・件名・見積日は事例の列（見積り事例の画面で直せる）を使う。
// 自社情報（取引銀行・口座）は入れない
export type QuoteSnapshot = {
  version: 1;
  groups: QuoteGroup[];
  extras: CoverExtra[];
  coverNotes: string[];
  fixedRemarks: FixedRemarks;
  settings: QuoteSettings;
};

export type EditorState = {
  client: string;
  title: string;
  date: string; // YYYY-MM-DD
  groups: QuoteGroup[];
  calcs: GroupCalc[];
  extras: CoverExtra[];
  coverNotes: string[];
  fixedRemarks: FixedRemarks;
  settings: QuoteSettings;
  subtotal: number; // 税抜小計
};

export function snapshotOf(s: EditorState): QuoteSnapshot {
  return { version: 1, groups: s.groups, extras: s.extras, coverNotes: s.coverNotes, fixedRemarks: s.fixedRemarks, settings: s.settings };
}

export function conditionsOf(c: CaseConditions): CaseConditions {
  const out = { ...EMPTY_CONDITIONS };
  for (const k of Object.keys(EMPTY_CONDITIONS) as (keyof CaseConditions)[]) (out as Record<string, unknown>)[k] = c[k];
  return out;
}

// 元にした見積りの条件に、新しい現場の条件（入れたものだけ）を重ねる
export function mergeConditions(base: CaseConditions, over: CaseConditions): CaseConditions {
  const out = conditionsOf(base);
  for (const k of Object.keys(EMPTY_CONDITIONS) as (keyof CaseConditions)[]) {
    const v = over[k];
    if (v !== null && String(v).trim() !== "") (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function infoOf(c: QuoteCase): QuoteCaseInfo {
  const info: QuoteCaseInfo & Partial<Pick<QuoteCase, "groups" | "extras">> = { ...c };
  delete info.groups;
  delete info.extras;
  return info;
}

// 保存する事例。内訳は自動計算の単価を入れた形で持つ（似た見積りの候補・下書きに使う）。
// 条件が空なら件名と品目から推測する
export function caseFromEditor(s: EditorState, cond: CaseConditions, note: string, sourceFile: string): QuoteCase {
  const groups: CaseGroup[] = s.groups.map((g, gi) => ({
    name: g.name,
    spec: g.spec,
    notes: g.notes,
    items: s.calcs[gi].items
      .filter((i) => !isBlankItem(i))
      .map((i) => ({
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
  const extras: CaseExtra[] = s.extras
    .filter((x) => x.name.trim())
    .map((x) => ({ name: x.name, spec: x.spec, unit: x.unit, qty: x.qty, unitPrice: x.unitPrice }));
  const title = s.title.trim();
  const conditions = conditionParts(cond).length > 0 ? conditionsOf(cond) : guessConditions(title, groups, extras);
  return {
    id: null,
    title,
    client: s.client.trim(),
    quoteDate: s.date || null,
    sourceFile,
    subtotal: s.subtotal,
    note: note.trim(),
    groups,
    extras,
    ...conditions,
  };
}

// 単価表・元の見積りから入れた単価は「保存した単価」にして、開いた時に単価表で入れ直さない
function keepPrice(item: QuoteItem): QuoteItem {
  return item.source === "table" || item.source === "case" ? { ...item, source: "saved", stale: false } : item;
}

export type OpenedQuote = {
  groups: QuoteGroup[];
  extras: CoverExtra[];
  coverNotes: string[];
  fixedRemarks: FixedRemarks;
  settings: QuoteSettings | null; // null＝保存されていない（今の設定のまま）
};

// 保存した画面の中身を戻す。ない時（Excelから登録した見積り）は、事例の内訳を、その見積りの単価のまま開く
export function openQuote(c: QuoteCase, editor: unknown): OpenedQuote {
  const snap = editor as Partial<QuoteSnapshot> | null;
  if (snap && typeof snap === "object" && Array.isArray(snap.groups)) {
    return {
      groups: snap.groups.map((g) => ({ ...g, notes: g.notes ?? [], items: (g.items ?? []).map(keepPrice) })),
      extras: Array.isArray(snap.extras) ? snap.extras : [],
      coverNotes: Array.isArray(snap.coverNotes) ? snap.coverNotes : [],
      fixedRemarks: { ...EMPTY_FIXED_REMARKS, ...snap.fixedRemarks },
      settings: { ...DEFAULT_SETTINGS, ...snap.settings },
    };
  }
  const draft = draftFromCase(c, null, { durationMonths: null, staleDays: DEFAULT_SETTINGS.staleDays });
  return {
    groups: draft.groups.map((g) => ({
      ...g,
      items: g.items.map((i): QuoteItem =>
        i.fallback ? { ...i, unitPrice: i.fallback.unitPrice, source: "saved", priceDate: i.fallback.date, priceFile: i.fallback.file } : i,
      ),
    })),
    extras: draft.extras,
    coverNotes: [],
    fixedRemarks: EMPTY_FIXED_REMARKS,
    settings: null,
  };
}

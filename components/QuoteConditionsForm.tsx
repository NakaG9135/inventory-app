"use client";

import { useEffect, useId, useState } from "react";
import {
  SERVICE_KIND_LABELS,
  STRUCTURES,
  WORK_TYPES,
  type CaseConditions,
  type ServiceKind,
} from "@/lib/quote/cases";

const input = "border rounded px-2 py-1 text-sm w-full";

function parseNum(text: string): number | null {
  const v = text.normalize("NFKC").replace(/[,\s]/g, "");
  if (!v) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function NumField({
  label,
  unit,
  hint,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  hint?: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  // 外から値が変わった時（読み込み・リセット）だけ表示を合わせる
  useEffect(() => {
    setText((t) => (parseNum(t) === value ? t : value === null ? "" : String(value)));
  }, [value]);
  return (
    <label className="text-sm">
      {label}
      {hint && <span className="text-xs text-gray-400 ml-1">{hint}</span>}
      <span className="flex items-center gap-1">
        <input
          className={input}
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parseNum(e.target.value));
          }}
        />
        <span className="text-xs text-gray-500 whitespace-nowrap">{unit}</span>
      </span>
    </label>
  );
}

// 現場の条件（工事種類・ハウスの大きさ・引込・建物）を入れる欄
export default function QuoteConditionsForm({
  value,
  onChange,
  disabled = false,
}: {
  value: CaseConditions;
  onChange: (v: CaseConditions) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const set = <K extends keyof CaseConditions>(key: K, v: CaseConditions[K]) => onChange({ ...value, [key]: v });

  return (
    <fieldset disabled={disabled} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <label className="text-sm">
        工事種類
        <input className={input} list={`${id}-work`} value={value.workType} onChange={(e) => set("workType", e.target.value)} />
        <datalist id={`${id}-work`}>
          {WORK_TYPES.map((w) => <option key={w} value={w} />)}
        </datalist>
      </label>
      <NumField label="連棟数" hint="シングル＝1" unit="連棟" value={value.houseUnits} onChange={(v) => set("houseUnits", v)} />
      <NumField label="階数" hint="平屋＝1" unit="階" value={value.floors} onChange={(v) => set("floors", v)} />
      <NumField label="棟数" unit="棟" value={value.buildings} onChange={(v) => set("buildings", v)} />
      <NumField label="引込容量" unit="kVA" value={value.capacityKva} onChange={(v) => set("capacityKva", v)} />
      <label className="text-sm">
        電灯／動力
        <select className={input} value={value.serviceKind} onChange={(e) => set("serviceKind", e.target.value as ServiceKind)}>
          <option value="">（指定なし）</option>
          {Object.entries(SERVICE_KIND_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </label>
      <label className="text-sm">
        構造
        <input className={input} list={`${id}-structure`} placeholder="RC・S・SRC…" value={value.structure} onChange={(e) => set("structure", e.target.value)} />
        <datalist id={`${id}-structure`}>
          {STRUCTURES.map((s) => <option key={s} value={s} />)}
        </datalist>
      </label>
      <NumField label="延床面積" unit="㎡" value={value.floorArea} onChange={(v) => set("floorArea", v)} />
      <NumField label="敷地面積" unit="㎡" value={value.siteArea} onChange={(v) => set("siteArea", v)} />
      <NumField label="工期" unit="ヶ月" value={value.durationMonths} onChange={(v) => set("durationMonths", v)} />
    </fieldset>
  );
}

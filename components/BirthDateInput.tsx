"use client";

import { useState } from "react";

// 西暦の年に対応する和暦（年の途中で元号が変わった年は両方）
const eraLabel = (y: number) => {
  if (y > 2019) return `令和${y - 2018}年`;
  if (y === 2019) return "平成31年・令和元年";
  if (y > 1989) return `平成${y - 1988}年`;
  if (y === 1989) return "昭和64年・平成元年";
  if (y > 1926) return `昭和${y - 1925}年`;
  if (y === 1926) return "大正15年・昭和元年";
  return `大正${y - 1911}年`;
};

// "1985-03-09" → "1985年（昭和60年）3月9日"
export const formatBirthDate = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return `${y}年（${eraLabel(y)}）${m}月${d}日`;
};

const pad = (n: number) => String(n).padStart(2, "0");

// 生年月日の入力（年・月・日を選ぶ）。3つとも選ぶと "YYYY-MM-DD"、そろうまでは "" を返す
export default function BirthDateInput({ onChange, disabled }: { onChange: (value: string) => void; disabled?: boolean }) {
  const [year, setYear] = useState(0);
  const [month, setMonth] = useState(0);
  const [day, setDay] = useState(0);

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 101 }, (_, i) => thisYear - i);
  // 年が未選択の間は、うるう年として2月29日まで選べるようにする
  const daysInMonth = month ? new Date(year || 2000, month, 0).getDate() : 31;

  const update = (y: number, m: number, d: number) => {
    const max = m ? new Date(y || 2000, m, 0).getDate() : 31;
    const fixedDay = d > max ? 0 : d;
    setYear(y);
    setMonth(m);
    setDay(fixedDay);
    onChange(y && m && fixedDay ? `${y}-${pad(m)}-${pad(fixedDay)}` : "");
  };

  const cls = "border p-2 bg-white disabled:bg-gray-100";

  return (
    <div className="flex gap-2">
      <select aria-label="生まれた年" value={year} onChange={(e) => update(Number(e.target.value), month, day)} disabled={disabled} className={`${cls} flex-1 min-w-0`}>
        <option value={0}>年</option>
        {years.map((y) => <option key={y} value={y}>{y}年（{eraLabel(y)}）</option>)}
      </select>
      <select aria-label="生まれた月" value={month} onChange={(e) => update(year, Number(e.target.value), day)} disabled={disabled} className={cls}>
        <option value={0}>月</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}月</option>)}
      </select>
      <select aria-label="生まれた日" value={day} onChange={(e) => update(year, month, Number(e.target.value))} disabled={disabled} className={cls}>
        <option value={0}>日</option>
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}日</option>)}
      </select>
    </div>
  );
}

"use client";

import { stripNoteMark } from "@/lib/quote/normalize";

type Props = {
  notes: string[];
  onChange: (notes: string[]) => void;
  placeholder?: string;
  minLines?: number;
};

// ※の注意書きの入力欄。最低 minLines 行出し、全部埋まると1行増える。
// 先頭の※は画面では左に固定で出し、Excelでは自動で付ける
export default function NoteLines({ notes, onChange, placeholder, minLines = 3 }: Props) {
  const values = notes.map(stripNoteMark);
  let last = -1;
  values.forEach((v, i) => {
    if (v.trim()) last = i;
  });
  const count = Math.max(minLines, last + 2);
  return (
    <div className="space-y-1">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="text-sm text-gray-500 w-4 text-center">※</span>
          <input
            className="flex-1 border rounded px-2 py-1 text-sm"
            value={values[i] ?? ""}
            placeholder={i === 0 ? placeholder : ""}
            onChange={(e) => {
              const next = Array.from({ length: Math.max(values.length, i + 1) }, (_, j) => values[j] ?? "");
              next[i] = stripNoteMark(e.target.value);
              // 後ろの空行は持たない
              while (next.length > 0 && !next[next.length - 1].trim()) next.pop();
              onChange(next);
            }}
          />
        </div>
      ))}
    </div>
  );
}

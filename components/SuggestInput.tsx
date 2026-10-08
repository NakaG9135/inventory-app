"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isFuzzyMatch } from "@/lib/fuzzyMatch";
import { normKey } from "@/lib/quote/normalize";

export type SuggestOption = { value: string; hint?: string };

type Props = {
  value: string;
  // 開いた時だけ作れば済むよう、関数でも渡せる
  options: SuggestOption[] | (() => SuggestOption[]);
  onChange: (value: string) => void;
  // 候補を選んだ時（option あり）と、候補にない文字を手入力したまま確定した時（Enter・フォーカスが外れた時）。
  // prev＝入力を始める前の値。値が変わっていなければ呼ばない
  onCommit?: (value: string, option: SuggestOption | null, prev: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  maxItems?: number;
};

// 入力に近い順：完全一致 → 前方一致 → 含む → 似ている（表記ゆれ・ひらがな/カタカナ・ローマ字）
function rank(options: SuggestOption[], query: string, max: number): SuggestOption[] {
  const q = normKey(query);
  if (!q) return options.slice(0, max);
  const scored: { o: SuggestOption; score: number; i: number }[] = [];
  options.forEach((o, i) => {
    const v = normKey(o.value);
    const score = v === q ? 0 : v.startsWith(q) ? 1 : v.includes(q) ? 2 : isFuzzyMatch(query, o.value) ? 3 : -1;
    if (score >= 0) scored.push({ o, score, i });
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return scored.slice(0, max).map((s) => s.o);
}

// 候補つきの入力欄。候補から選ぶことも、候補にない文字をそのまま入れることもできる。
// 候補の一覧は表の横スクロールで切れないよう画面に固定して出す
export default function SuggestInput({ value, options, onChange, onCommit, placeholder, className = "", autoFocus, maxItems = 40 }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const startValue = useRef(value);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const list = useMemo(() => {
    if (!open) return [];
    const all = typeof options === "function" ? options() : options;
    return rank(all, typed ? value : "", maxItems);
  }, [open, options, typed, value, maxItems]);

  useEffect(() => {
    if (!open) return;
    const place = () => inputRef.current && setRect(inputRef.current.getBoundingClientRect());
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const commit = (v: string, option: SuggestOption | null) => {
    const prev = startValue.current;
    startValue.current = v;
    if (option || v !== prev) onCommit?.(v, option, prev);
  };

  const pick = (o: SuggestOption) => {
    onChange(o.value);
    commit(o.value, o);
    setOpen(false);
    setTyped(false);
    setActive(-1);
  };

  let style: React.CSSProperties | undefined;
  if (rect) {
    const below = window.innerHeight - rect.bottom;
    const up = below < 220 && rect.top > below;
    style = {
      position: "fixed",
      left: rect.left,
      minWidth: Math.max(rect.width, 224),
      maxWidth: `calc(100vw - ${Math.max(0, rect.left) + 8}px)`,
      ...(up ? { bottom: window.innerHeight - rect.top + 2 } : { top: rect.bottom + 2 }),
    };
  }

  return (
    <>
      <input
        ref={inputRef}
        className={className}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        onFocus={() => {
          startValue.current = value;
          setTyped(false);
          setActive(-1);
          setOpen(true);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          setActive(-1);
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          commit(value, null);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, list.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, -1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && active >= 0 && list[active]) pick(list[active]);
            else {
              setOpen(false);
              commit(value, null);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && style && list.length > 0 && (
        <ul style={style} className="z-50 max-h-64 overflow-y-auto bg-white border rounded shadow-lg text-sm text-left font-normal">
          {list.map((o, i) => (
            <li
              key={`${o.value}|${i}`}
              className={`px-2 py-1 cursor-pointer whitespace-nowrap ${i === active ? "bg-blue-100" : "hover:bg-blue-50"}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              {o.value}
              {o.hint && <span className="text-xs text-gray-500 ml-2">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

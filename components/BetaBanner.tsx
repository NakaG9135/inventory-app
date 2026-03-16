"use client";

import { useState, useEffect } from "react";

export default function BetaBanner() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 60000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="bg-yellow-400 text-black text-center text-[14px] font-bold py-1 sticky top-0 z-[100] md:pointer-events-none cursor-pointer"
      onClick={() => setVisible(false)}
    >
      現在βテスト中　好きなようにいじって触って慣れといてください。　数値などぐちゃぐちゃになってOK,ログもめちゃくちゃになってOK。　実装時アカウント以外リセットします。　日々更新して変更されます。　こうしてほしい、こういう機能欲しいという方、悠介まで。
    </div>
  );
}

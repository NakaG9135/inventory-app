"use client";

import { useState, useEffect, useRef } from "react";

export default function BetaBanner() {
  const [mobileVisible, setMobileVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMobileVisible(false), 60000);
  };

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const show = () => {
    setMobileVisible(true);
    startTimer();
  };

  const bannerText = "現在βテスト中　好きなようにいじって触って慣れといてください。　数値などぐちゃぐちゃになってOK,ログもめちゃくちゃになってOK。　実装時アカウント以外リセットします。　日々更新して変更されます。　こうしてほしい、こういう機能欲しいという方、悠介まで。";

  return (
    <>
      {/* PC: 常時表示 */}
      <div className="hidden md:block bg-yellow-400 text-black text-center text-[14px] font-bold py-1 sticky top-0 z-[100]">
        {bannerText}
      </div>

      {/* スマホ: トグル */}
      {mobileVisible ? (
        <div
          className="md:hidden bg-yellow-400 text-black text-center text-[14px] font-bold py-1 sticky top-0 z-[100] cursor-pointer"
          onClick={() => setMobileVisible(false)}
        >
          {bannerText}
        </div>
      ) : (
        <button
          onClick={show}
          className="md:hidden fixed top-2 right-2 z-[100] bg-yellow-400 text-black text-[16px] font-bold px-4 py-2 rounded shadow"
        >
          お知らせ
        </button>
      )}
    </>
  );
}

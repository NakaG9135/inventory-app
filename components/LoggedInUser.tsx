"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// あいさつを出したかどうかの目印。ログイン画面がログイン成功時に消すので、ログインし直すともう一度出る
export const GREETING_SHOWN_KEY = "loginGreetingShown";
// 「登録情報変更」で名前を変えた時に、右上の表示もすぐ変えるための合図
export const PROFILE_UPDATED_EVENT = "profile-updated";

const GREETING_MS = 3000;
const FADE_MS = 300;

const readSession = (key: string) => {
  try { return sessionStorage.getItem(key); } catch { return null; }
};
const writeSession = (key: string, value: string) => {
  try { sessionStorage.setItem(key, value); } catch { /* 保存できない環境では、画面を開き直すたびに出る */ }
};

// ログインしている人の名前を画面の上に出し、アプリを開いた時（ログイン時を含む）に中央へあいさつを出す
export default function LoggedInUser() {
  const [name, setName] = useState("");
  const [greeting, setGreeting] = useState<"hidden" | "shown" | "leaving">("hidden");
  const greeted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        const { data } = await supabase
          .from("users_profile")
          .select("name")
          .eq("id", session.user.id)
          .maybeSingle();
        const loaded = typeof data?.name === "string" ? data.name.trim() : "";
        if (!cancelled && loaded) setName(loaded);
      } catch {
        // 名前を取れない時は、表示しないだけ（画面の利用は止めない）
      }
    };
    load();
    const reload = () => { load(); };
    window.addEventListener(PROFILE_UPDATED_EVENT, reload);
    return () => {
      cancelled = true;
      window.removeEventListener(PROFILE_UPDATED_EVENT, reload);
    };
  }, []);

  // 名前が分かったら、1回だけあいさつを出す
  useEffect(() => {
    if (!name || greeted.current) return;
    greeted.current = true;
    if (readSession(GREETING_SHOWN_KEY)) return;
    writeSession(GREETING_SHOWN_KEY, "1");
    setGreeting("shown");
  }, [name]);

  // 数秒たったら、ふわっと消す
  useEffect(() => {
    if (greeting === "hidden") return;
    const timer = window.setTimeout(
      () => setGreeting(greeting === "shown" ? "leaving" : "hidden"),
      greeting === "shown" ? GREETING_MS : FADE_MS
    );
    return () => window.clearTimeout(timer);
  }, [greeting]);

  useEffect(() => {
    if (greeting !== "shown") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") setGreeting("leaving");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [greeting]);

  return (
    <>
      {/* スマホ：左上のメニューボタンと右上の「お知らせ」の間に収める。PC：画面上部の黄色い帯の下、右端 */}
      <div className="shrink-0 h-14 md:h-auto md:min-h-9 flex items-center justify-end pl-14 pr-[124px] md:px-6 md:pt-2">
        {name && (
          <p className="min-w-0 truncate text-[15px] md:text-sm font-bold text-gray-700" title={`${name} 様`}>
            {name} 様
          </p>
        )}
      </div>

      {greeting !== "hidden" && (
        <div
          role="status"
          aria-live="polite"
          onClick={() => setGreeting("leaving")}
          className={`fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/30 cursor-pointer transition-opacity duration-300 ${
            greeting === "leaving" ? "opacity-0" : "opacity-100"
          }`}
        >
          <div className="max-w-full bg-white rounded-2xl shadow-2xl px-6 py-8 md:px-12 md:py-10 text-center">
            <p className="text-xl md:text-3xl font-bold text-gray-800">お疲れ様です。</p>
            <p className="mt-3 text-2xl md:text-4xl font-bold text-blue-700 break-words">{name} 様、</p>
            <p className="mt-3 text-xl md:text-3xl font-bold text-gray-800">ただいまログイン中</p>
          </div>
        </div>
      )}
    </>
  );
}

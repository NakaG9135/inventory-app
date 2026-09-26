"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { collectDeviceInfo } from "@/lib/deviceInfo";

const SESSION_KEY = "accessLogged";
const NOTICE_KEY = "locationNoticeAccepted";
export const JUST_LOGGED_IN_KEY = "justLoggedIn";

const LOCATION_NOTICE =
  "会社のデータを扱うアプリのため、問題が発生した際の保険手続きに備えて、位置情報の取得を許可してください。";

const readStorage = (store: Storage, key: string) => {
  try { return store.getItem(key); } catch { return null; }
};
const writeStorage = (store: Storage, key: string, value: string | null) => {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch { /* 保存できない環境では毎回記録される */ }
};

async function recordLocation() {
  if (!("geolocation" in navigator)) {
    await supabase.rpc("log_location", { p_status: "unsupported", p_latitude: null, p_longitude: null, p_accuracy: null });
    return;
  }
  await new Promise<void>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await supabase.rpc("log_location", {
          p_status: "ok",
          p_latitude: pos.coords.latitude,
          p_longitude: pos.coords.longitude,
          p_accuracy: pos.coords.accuracy,
        });
        resolve();
      },
      async (err) => {
        const status = err.code === err.PERMISSION_DENIED ? "denied" : err.code === err.TIMEOUT ? "timeout" : "unavailable";
        await supabase.rpc("log_location", { p_status: status, p_latitude: null, p_longitude: null, p_accuracy: null });
        resolve();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

// アプリを開いた時（ログイン時を含む）に、接続情報と位置情報を1回記録する
export default function AccessLogger() {
  const [showNotice, setShowNotice] = useState(false);

  useEffect(() => {
    if (readStorage(sessionStorage, SESSION_KEY)) return;
    writeStorage(sessionStorage, SESSION_KEY, "1");

    (async () => {
      const event = readStorage(sessionStorage, JUST_LOGGED_IN_KEY) ? "login" : "open";
      writeStorage(sessionStorage, JUST_LOGGED_IN_KEY, null);
      try {
        const info = await collectDeviceInfo();
        await supabase.rpc("log_access", { p_event: event, p_info: info });
      } catch {
        // 記録に失敗しても画面の利用は止めない
      }
      if (readStorage(localStorage, NOTICE_KEY)) {
        recordLocation();
      } else {
        setShowNotice(true);
      }
    })();
  }, []);

  if (!showNotice) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-lg">
        <h2 className="font-bold text-lg mb-2">位置情報の取得について</h2>
        <p className="text-sm text-gray-700 mb-4">{LOCATION_NOTICE}</p>
        <p className="text-xs text-gray-500 mb-4">この後に表示される確認で「許可」を選んでください。</p>
        <button
          onClick={() => {
            writeStorage(localStorage, NOTICE_KEY, "1");
            setShowNotice(false);
            recordLocation();
          }}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg"
        >
          OK
        </button>
      </div>
    </div>
  );
}

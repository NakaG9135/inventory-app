"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import BirthDateInput, { formatBirthDate } from "@/components/BirthDateInput";

// 生年月日が未登録の人に、アプリを開いた時（ログイン時を含む）に入力してもらう。
// 登録すると名簿に記録され、次からは表示されない（パスワードを忘れた時の本人確認に使う）
export default function BirthDatePrompt() {
  const [needed, setNeeded] = useState(false);
  const [birthDate, setBirthDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("my_birth_date_needed").then(({ data, error: rpcError }) => {
      if (!cancelled && !rpcError && data === true) setNeeded(true);
    });
    return () => { cancelled = true; };
  }, []);

  if (!needed) return null;

  const save = async () => {
    setError("");
    if (!birthDate) {
      setError("年・月・日をすべて選んでください。");
      return;
    }
    if (!confirm(`${formatBirthDate(birthDate)} で登録しますか？\nあとで直す場合は、社長に依頼してください。`)) return;
    setSaving(true);
    const { error: saveError } = await supabase.rpc("set_my_birth_date", { p_birth_date: birthDate });
    setSaving(false);
    if (saveError) {
      setError(`登録できませんでした（${saveError.message}）`);
      return;
    }
    setNeeded(false);
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-6 w-96 max-w-full">
        <h2 className="text-lg font-bold mb-2">生年月日の登録をお願いします</h2>
        <p className="text-sm text-gray-600 mb-4">
          パスワードを忘れた時に、ご本人であることを確かめるために使います。
          登録は1回だけで、次からは表示されません。
        </p>
        <BirthDateInput onChange={setBirthDate} disabled={saving} />
        <button
          onClick={save}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 w-full rounded mt-4 disabled:opacity-50"
        >
          {saving ? "登録中…" : "登録する"}
        </button>
        {error && (
          <>
            <p className="text-red-600 mt-3 text-sm bg-red-50 border border-red-200 rounded p-2" role="alert">{error}</p>
            {/* 登録できない時にアプリが使えなくならないよう、失敗した時だけ閉じられるようにする */}
            {error.startsWith("登録できませんでした") && (
              <button onClick={() => setNeeded(false)} className="text-sm text-gray-500 underline mt-3">
                今は閉じる（次に開いた時にもう一度表示されます）
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

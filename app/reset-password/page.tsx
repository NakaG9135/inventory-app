"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { isStandalone } from "@/components/InstallGate";
import { PASSWORD_RULES, PASSWORD_RULE_MESSAGE, isValidPassword } from "@/lib/password";
import { recoveryLinkError } from "@/lib/recoveryLink";

// Supabase のエラーを、利用者に分かる日本語にする
const updateErrorMessage = (message: string) => {
  const m = message.toLowerCase();
  if (m.includes("different from the old")) return "前と同じパスワードは使えません。別のパスワードにしてください。";
  if (m.includes("weak") || m.includes("should contain") || m.includes("at least")) return PASSWORD_RULE_MESSAGE;
  if (m.includes("session missing") || m.includes("expired") || m.includes("jwt")) return "時間が経ったため、このリンクは使えなくなりました。アプリのログイン画面の「パスワードを忘れた方はこちら」から、もう一度メールを送ってください。";
  if (m.includes("failed to fetch") || m.includes("network") || m.includes("load failed")) return "通信できませんでした。電波やWi-Fiの状態を確認して、もう一度お試しください。";
  return `パスワードを変更できませんでした（${message}）`;
};

// メールの再設定リンクから開く画面。新しいパスワードを決める
export default function ResetPasswordPage() {
  const [view, setView] = useState<"checking" | "form" | "invalid" | "done">("checking");
  const [accountEmail, setAccountEmail] = useState("");
  const [inApp, setInApp] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const standalone = isStandalone();
      // リンクが期限切れ・使用済みの時は、ログイン中の別のアカウントを変えてしまわないよう先に止める
      if (recoveryLinkError) {
        if (!cancelled) {
          setInApp(standalone);
          setView("invalid");
        }
        return;
      }
      // リンクの確認が済むまで待ってから、ログイン状態を受け取る
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setInApp(standalone);
      setAccountEmail(data.session?.user.email ?? "");
      setView(data.session ? "form" : "invalid");
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    setError("");

    if (!isValidPassword(password)) {
      setError(PASSWORD_RULE_MESSAGE);
      return;
    }
    if (password !== confirm) {
      setError("2つのパスワードが一致していません。もう一度入力してください。");
      return;
    }

    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateErrorMessage(updateError.message));
        return;
      }
      // どの端末も、新しいパスワードでログインし直してもらう
      await supabase.auth.signOut();
      setView("done");
    } catch (err) {
      setError(updateErrorMessage(err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const inputType = show ? "text" : "password";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <div className="bg-white p-6 rounded shadow w-96 max-w-full">
        <h1 className="text-xl mb-4">新しいパスワードの設定</h1>

        {view === "checking" && <p className="text-sm text-gray-600">確認中…</p>}

        {view === "invalid" && (
          <div className="text-sm text-gray-700 space-y-3">
            <p className="bg-red-50 border border-red-200 rounded p-3 text-red-700" role="alert">
              このリンクは使えません。有効期限が切れているか、すでに使われています。
            </p>
            <p>
              アプリのログイン画面の「パスワードを忘れた方はこちら」から、もう一度メールを送ってください。
              リンクは、届いた中で一番新しいメールのものを使ってください。
            </p>
            {inApp && (
              <a href="/forgot-password" className="block text-center bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 w-full rounded">
                もう一度メールを送る
              </a>
            )}
          </div>
        )}

        {view === "form" && (
          <form onSubmit={handleSave}>
            {accountEmail && (
              <p className="text-sm text-gray-600 mb-3">
                <span className="font-semibold break-all">{accountEmail}</span> の新しいパスワードを決めてください。
              </p>
            )}
            <input
              type={inputType}
              placeholder="新しいパスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={saving}
              autoComplete="new-password"
              className="border p-2 w-full mb-2 disabled:bg-gray-100"
            />
            <input
              type={inputType}
              placeholder="新しいパスワード（もう一度）"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={saving}
              autoComplete="new-password"
              className="border p-2 w-full mb-1 disabled:bg-gray-100"
            />
            <label className="text-sm text-gray-600 flex items-center gap-1 mb-2">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
              入力したパスワードを表示する
            </label>
            <ul className="text-xs text-gray-500 mb-3 pl-1 space-y-0.5">
              {PASSWORD_RULES.map((rule) => <li key={rule}>・{rule}</li>)}
            </ul>
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-500 text-white px-4 py-2 w-full rounded flex items-center justify-center gap-2 disabled:bg-blue-400 disabled:cursor-wait"
            >
              {saving && (
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
              )}
              {saving ? "変更中…" : "このパスワードに変更する"}
            </button>
            {error && (
              <p className="text-red-600 mt-3 text-sm bg-red-50 border border-red-200 rounded p-2" role="alert">
                {error}
              </p>
            )}
          </form>
        )}

        {view === "done" && (
          <div className="text-sm text-gray-700 space-y-3">
            <p className="bg-green-50 border border-green-200 rounded p-3 text-green-800 font-semibold">
              パスワードを変更しました。
            </p>
            {inApp ? (
              <>
                <p>新しいパスワードでログインしてください。</p>
                <a href="/login" className="block text-center bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 w-full rounded">
                  ログイン画面へ
                </a>
              </>
            ) : (
              <p>
                この画面は閉じて、ホーム画面（パソコンはデスクトップ）の「在庫管理」アプリを開き、新しいパスワードでログインしてください。
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

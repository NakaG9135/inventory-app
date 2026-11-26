"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { fmtDateTime } from "@/lib/employees";
import { PASSWORD_RULES, PASSWORD_RULE_MESSAGE, generatePassword, isValidPassword } from "@/lib/password";

type AccountInfo = { email: string; last_sign_in_at: string | null };

// 従業員名簿の「アカウント」タブ：ログイン用メールアドレスの確認と、パスワードの再設定（社長専用）
export default function EmployeeAccount({ userId, name, birthDate }: { userId: string | null; name: string; birthDate: string | null }) {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSelf, setIsSelf] = useState(false);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // 再設定した新しいパスワード（この画面を開いている間だけ表示する。どこにも保存しない）
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const [account, session] = await Promise.all([
        supabase.rpc("employee_account_info", { p_user_id: userId }),
        supabase.auth.getSession(),
      ]);
      if (cancelled) return;
      if (account.error) {
        setLoadError(`アカウント情報を読み込めませんでした: ${account.error.message}`);
        return;
      }
      setInfo(((account.data ?? []) as AccountInfo[])[0] ?? { email: "", last_sign_in_at: null });
      setIsSelf(session.data.session?.user.id === userId);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (!userId) return <p className="text-sm text-gray-400">アカウントがないため、ログインの情報はありません</p>;
  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>;
  if (!info) return <p className="text-sm">読み込み中...</p>;

  const resetPassword = async () => {
    setError("");
    if (!isValidPassword(password)) {
      setError(PASSWORD_RULE_MESSAGE);
      return;
    }
    if (!confirm(`${name || "この従業員"} のパスワードを再設定しますか？\n今までのパスワードは使えなくなり、ログイン中の端末はログインし直しになります。`)) return;
    setSaving(true);
    const { error: resetError } = await supabase.rpc("admin_reset_user_password", { p_user_id: userId, p_new_password: password });
    setSaving(false);
    if (resetError) {
      setError(`再設定に失敗しました: ${resetError.message}`);
      return;
    }
    setNewPassword(password);
    setCopied(false);
    setPassword("");
  };

  const copyPassword = async () => {
    if (!newPassword) return;
    try {
      await navigator.clipboard.writeText(newPassword);
      setCopied(true);
    } catch {
      alert("コピーできませんでした。表示されているパスワードを書き写してください。");
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-gray-600 mb-1">ログイン用メールアドレス</p>
          <p className="font-medium break-all">{info.email || "—"}</p>
          <p className="text-xs text-gray-500 mt-1">ログインの時は、このメールアドレスを入力します。</p>
        </div>
        <div>
          <p className="text-xs text-gray-600 mb-1">最終ログイン</p>
          <p>{info.last_sign_in_at ? fmtDateTime(info.last_sign_in_at) : "—"}</p>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4">
        <h3 className="font-bold text-sm mb-2">パスワードの再設定</h3>
        <p className="text-sm text-gray-600 mb-3">
          今のパスワードは、元に戻せない形で保存されているため、誰にも表示できません。
          忘れた場合は、ここで新しいパスワードに置き換えて、本人に伝えてください。
        </p>

        {isSelf ? (
          <p className="text-sm">
            ご自身のパスワードは <Link href="/dashboard/profile" className="text-blue-600 underline">登録情報変更</Link> の画面で変更できます。
            忘れた場合は、ログイン画面の「パスワードを忘れた方はこちら」からメールで再設定してください
            （このアカウントは名簿と権限を扱えるため、氏名と生年月日だけでは再設定できないようにしてあります）。
          </p>
        ) : (
          <>
            {newPassword && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4 text-sm text-green-900">
                <p className="font-bold mb-2">再設定しました</p>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <span className="text-xs text-green-800">新しいパスワード</span>
                  <span className="font-mono text-lg bg-white border border-green-200 rounded px-3 py-1 select-all break-all">{newPassword}</span>
                  <button onClick={copyPassword} className="text-xs border border-green-600 text-green-800 rounded px-3 py-1 hover:bg-green-100">
                    {copied ? "コピーしました" : "コピー"}
                  </button>
                </div>
                <p>本人に伝えてください。この表示は画面を切り替えると消え、あとから見ることはできません。</p>
                <p className="mt-1">本人はログインした後、「登録情報変更」の画面で好きなパスワードに変えられます。</p>
              </div>
            )}

            <p className="text-sm text-gray-600 mb-3">
              本人がログイン画面の「パスワードを忘れた方はこちら」から自分で再設定する方法（メールアドレス・氏名・生年月日の一致）は、
              {birthDate
                ? "生年月日が登録済みなので使えます。氏名は「基本情報」の名前と同じ漢字で入力してもらいます。"
                : "生年月日が未登録のため、まだ使えません。「基本情報」で登録するか、本人が次にアプリを開いた時の入力で登録されます。"}
            </p>

            <div className="flex flex-wrap gap-2 max-w-md">
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={saving}
                placeholder="新しいパスワード"
                autoComplete="off"
                className="border rounded p-2 text-sm flex-1 min-w-[180px] font-mono bg-white disabled:bg-gray-50"
              />
              <button
                onClick={() => { setPassword(generatePassword()); setError(""); }}
                disabled={saving}
                className="border border-gray-300 rounded px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                自動で作る
              </button>
            </div>
            <ul className="text-xs text-gray-500 mt-2 pl-1 space-y-0.5">
              {PASSWORD_RULES.map((rule) => <li key={rule}>・{rule}</li>)}
            </ul>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <button
                onClick={resetPassword}
                disabled={saving || !password}
                className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded text-sm disabled:opacity-50"
              >
                {saving ? "再設定中…" : "このパスワードに再設定する"}
              </button>
              {error && <span className="text-sm text-red-600">{error}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

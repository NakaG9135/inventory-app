"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import BirthDateInput from "@/components/BirthDateInput";
import ShowPasswordToggle from "@/components/ShowPasswordToggle";
import { PASSWORD_RULES, PASSWORD_RULE_MESSAGE, isValidPassword } from "@/lib/password";

// 再設定メールの差出人・件名・リンクの文言。これらは Supabase の画面で決めているので、そちらを変えたらここも合わせる
// （差出人の名前＝Authentication → SMTP Settings の Sender name、件名とリンク＝Email Templates → Reset Password）
const RESET_MAIL_SENDER = "丸弘 佐々木電設 株式会社";
const RESET_MAIL_SUBJECT = "【在庫管理システム】パスワードの再設定";
const RESET_MAIL_LINK_TEXT = "パスワードを再設定する";

const NETWORK_ERROR = "通信できませんでした。電波やWi-Fiの状態を確認して、もう一度お試しください。";
const isNetworkError = (m: string) => m.includes("failed to fetch") || m.includes("network") || m.includes("load failed");

// Supabase のエラーを、利用者に分かる日本語にする
const sendErrorMessage = (message: string) => {
  const m = message.toLowerCase();
  if (m.includes("security purposes")) return "続けては送れません。1分ほどおいてから、もう一度お試しください。";
  if (m.includes("rate limit") || m.includes("too many")) return "メールを送れる回数の上限に達しました。1時間ほどおいてからもう一度試すか、社長にパスワードの再設定を依頼してください。";
  if (m.includes("email") && m.includes("invalid")) return "メールアドレスの形が正しくありません。入力を確認してください。";
  if (isNetworkError(m)) return NETWORK_ERROR;
  return `メールを送れませんでした。社長にパスワードの再設定を依頼してください。（${message}）`;
};

// パスワードを忘れた時の再設定。
// 「本人確認」＝メールアドレス・氏名・生年月日が登録と一致すれば、その場で新しいパスワードに変える
// 「メール」＝登録したメールアドレスに、再設定用のリンクを送る
export default function ForgotPasswordPage() {
  const [mode, setMode] = useState<"identity" | "email">("identity");
  const [email, setEmail] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<"changed" | "sent" | null>(null);
  const router = useRouter();

  const switchMode = (next: "identity" | "email") => {
    setMode(next);
    setError("");
  };

  const handleIdentity = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    setError("");

    if (!email.trim() || !lastName.trim() || !firstName.trim() || !birthDate) {
      setError("メールアドレス・姓・名・生年月日をすべて入力してください。");
      return;
    }
    if (!isValidPassword(password)) {
      setError(PASSWORD_RULE_MESSAGE);
      return;
    }
    if (password !== confirmPassword) {
      setError("2つのパスワードが一致していません。もう一度入力してください。");
      return;
    }

    setLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("reset_password_by_identity", {
        p_email: email.trim(),
        p_last_name: lastName,
        p_first_name: firstName,
        p_birth_date: birthDate,
        p_new_password: password,
      });
      if (rpcError) {
        setError(isNetworkError(rpcError.message.toLowerCase()) ? NETWORK_ERROR : `再設定できませんでした（${rpcError.message}）`);
      } else if (data === "ok") {
        setDone("changed");
      } else if (data === "locked") {
        setError("間違いが続いたため、しばらく使えません。1時間ほどおいてからもう一度試すか、社長にパスワードの再設定を依頼してください。");
      } else if (data === "invalid_password") {
        setError(PASSWORD_RULE_MESSAGE);
      } else {
        setError(
          "入力した内容が、登録されている情報と一致しませんでした。メールアドレス・氏名の漢字・生年月日を確認してください。" +
          "生年月日をまだ登録していない場合は、この方法は使えません。5回続けて間違えると、1時間使えなくなります。"
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(isNetworkError(message.toLowerCase()) ? NETWORK_ERROR : `再設定できませんでした（${message}）`);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    setError("");

    if (!email.trim()) {
      setError("メールアドレスを入力してください。");
      return;
    }

    setLoading(true);
    try {
      const { error: sendError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (sendError) {
        setError(sendErrorMessage(sendError.message));
        return;
      }
      setDone("sent");
    } catch (err) {
      setError(sendErrorMessage(err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "border p-2 w-full mb-2 disabled:bg-gray-100";
  const spinner = <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />;
  const submitCls = "bg-blue-500 text-white px-4 py-2 w-full rounded flex items-center justify-center gap-2 disabled:bg-blue-400 disabled:cursor-wait";
  const errorBox = error && (
    <p className="text-red-600 mt-3 text-sm bg-red-50 border border-red-200 rounded p-2" role="alert">
      {error}
    </p>
  );
  const backToLogin = (
    <button onClick={() => router.push("/login")} className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 w-full rounded">
      ログイン画面へ
    </button>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <div className="bg-white p-6 rounded shadow w-96 max-w-full">
        <h1 className="text-xl mb-4">パスワードの再設定</h1>

        {done === "changed" && (
          <div className="text-sm text-gray-700 space-y-3">
            <p className="bg-green-50 border border-green-200 rounded p-3 text-green-800 font-semibold">
              パスワードを変更しました。
            </p>
            <p>新しいパスワードでログインしてください。</p>
            {backToLogin}
          </div>
        )}

        {done === "sent" && (
          <div className="text-sm text-gray-700 space-y-3">
            <p className="bg-green-50 border border-green-200 rounded p-3 text-green-800">
              <span className="font-semibold break-all">{email.trim()}</span> が登録されていれば、再設定用のメールが届きます。
            </p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>届いたメールの中のリンク「{RESET_MAIL_LINK_TEXT}」を開く</li>
              <li>開いた画面で新しいパスワードを決める</li>
              <li>このアプリに戻って、新しいパスワードでログインする</li>
            </ol>
            <p className="text-xs text-gray-500">
              メールは「{RESET_MAIL_SENDER}」から、件名「{RESET_MAIL_SUBJECT}」で届きます。数分待っても届かない時は、迷惑メールのフォルダと、
              メールアドレスが登録した時のものかを確認してください。それでも届かない場合は、社長にパスワードの再設定を依頼してください。
            </p>
            {backToLogin}
          </div>
        )}

        {!done && mode === "identity" && (
          <form onSubmit={handleIdentity}>
            <p className="text-sm text-gray-600 mb-3">
              メールアドレス・氏名・生年月日が登録と一致すると、その場で新しいパスワードに変更できます。
            </p>
            <input
              type="email"
              placeholder="メールアドレス"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoComplete="email"
              className={inputCls}
            />
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="姓"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={loading}
                autoComplete="family-name"
                className="border p-2 mb-2 flex-1 min-w-0 disabled:bg-gray-100"
              />
              <input
                type="text"
                placeholder="名"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={loading}
                autoComplete="given-name"
                className="border p-2 mb-2 flex-1 min-w-0 disabled:bg-gray-100"
              />
            </div>
            <p className="text-xs text-gray-600 mb-1">生年月日</p>
            <BirthDateInput onChange={setBirthDate} disabled={loading} />

            <p className="text-xs text-gray-600 mt-4 mb-1">新しいパスワード</p>
            <input
              type={show ? "text" : "password"}
              placeholder="新しいパスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
              className={inputCls}
            />
            <input
              type={show ? "text" : "password"}
              placeholder="新しいパスワード（もう一度）"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
              className="border p-2 w-full mb-1 disabled:bg-gray-100"
            />
            <ShowPasswordToggle checked={show} onChange={setShow} />
            <ul className="text-xs text-gray-500 mb-3 pl-1 space-y-0.5">
              {PASSWORD_RULES.map((rule) => <li key={rule}>・{rule}</li>)}
            </ul>
            <button type="submit" disabled={loading} className={submitCls}>
              {loading && spinner}
              {loading ? "確認中…" : "パスワードを変更する"}
            </button>
            {errorBox}
            <p className="text-xs text-gray-500 mt-4">
              生年月日をまだ登録していない場合や、一致しない場合は、メールで再設定するか、社長にパスワードの再設定を依頼してください。
            </p>
            <p className="text-blue-600 mt-3 cursor-pointer" onClick={() => switchMode("email")}>
              メールで再設定する
            </p>
            <p className="text-blue-600 mt-2 cursor-pointer" onClick={() => router.push("/login")}>
              ← ログイン画面へ
            </p>
          </form>
        )}

        {!done && mode === "email" && (
          <form onSubmit={handleSend}>
            <p className="text-sm text-gray-600 mb-3">
              登録したメールアドレスに、パスワードを決め直すためのメールを送ります。
            </p>
            <input
              type="email"
              placeholder="メールアドレス"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoComplete="email"
              className={inputCls}
            />
            <button type="submit" disabled={loading} className={submitCls}>
              {loading && spinner}
              {loading ? "送信中…" : "再設定用のメールを送る"}
            </button>
            {errorBox}
            <p className="text-xs text-gray-500 mt-4">
              メールアドレスも分からない場合は、社長にパスワードの再設定を依頼してください。
            </p>
            <p className="text-blue-600 mt-3 cursor-pointer" onClick={() => switchMode("identity")}>
              氏名と生年月日で再設定する
            </p>
            <p className="text-blue-600 mt-2 cursor-pointer" onClick={() => router.push("/login")}>
              ← ログイン画面へ
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

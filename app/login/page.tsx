"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

// Supabase のエラーを、利用者に分かる日本語にする
const loginErrorMessage = (message: string) => {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "メールアドレスまたはパスワードが違います。";
  if (m.includes("email not confirmed")) return "メールアドレスの確認が済んでいません。登録時に届いたメールのリンクを開いてから、もう一度ログインしてください。";
  if (m.includes("rate limit") || m.includes("too many")) return "ログインの試行が多すぎます。少し時間をおいてから、もう一度お試しください。";
  if (m.includes("failed to fetch") || m.includes("network") || m.includes("load failed")) return "通信できませんでした。電波やWi-Fiの状態を確認して、もう一度お試しください。";
  return `ログインできませんでした（${message}）`;
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    setError("");

    if (!email.trim() || !password) {
      setError("メールアドレスとパスワードを入力してください。");
      return;
    }

    setLoading(true);
    try {
      // 失敗カウント確認
      const { data: userProfile } = await supabase
        .from("users_profile")
        .select("failed_attempts, locked")
        .eq("email", email)
        .single();

      if (userProfile?.locked) {
        setError("このアカウントはロックされています。管理者にお問い合わせください。");
        setLoading(false);
        return;
      }

      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        // 失敗したらカウントを+1
        if (userProfile) {
          const attempts = (userProfile.failed_attempts || 0) + 1;

          if (attempts >= 5) {
            await supabase
              .from("users_profile")
              .update({ locked: true, failed_attempts: attempts })
              .eq("email", email);

            setError("5回失敗したためアカウントがロックされました。");
            setLoading(false);
            return;
          }

          await supabase
            .from("users_profile")
            .update({ failed_attempts: attempts })
            .eq("email", email);
        }

        setError(loginErrorMessage(authError.message));
        setLoading(false);
        return;
      }

      // 成功したらリセット
      await supabase
        .from("users_profile")
        .update({ failed_attempts: 0 })
        .eq("email", email);

      // 画面が切り替わるまで「ログイン中…」のままにする
      router.push("/dashboard");
    } catch (err) {
      setError(loginErrorMessage(err instanceof Error ? err.message : String(err)));
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <form onSubmit={handleLogin} className="bg-white p-6 rounded shadow w-96">
        <h1 className="text-xl mb-4">ログイン</h1>
        <input
          type="email"
          placeholder="メールアドレス"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          autoComplete="email"
          className="border p-2 w-full mb-2 disabled:bg-gray-100"
        />
        <input
          type="password"
          placeholder="パスワード"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          autoComplete="current-password"
          className="border p-2 w-full mb-2 disabled:bg-gray-100"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-500 text-white px-4 py-2 w-full rounded flex items-center justify-center gap-2 disabled:bg-blue-400 disabled:cursor-wait"
        >
          {loading && (
            <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          )}
          {loading ? "ログイン中…" : "ログイン"}
        </button>
        {error && (
          <p className="text-red-600 mt-3 text-sm bg-red-50 border border-red-200 rounded p-2" role="alert">
            {error}
          </p>
        )}
        <p
          className="text-blue-600 mt-4 cursor-pointer"
          onClick={() => router.push("/register")}
        >
          新規登録はこちら
        </p>
      </form>
    </div>
  );
}

"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleLogin = async () => {
    setError("");

    // 失敗カウント確認
    const { data: userProfile } = await supabase
      .from("users_profile")
      .select("failed_attempts, locked")
      .eq("email", email)
      .single();

    if (userProfile?.locked) {
      setError("このアカウントはロックされています。管理者にお問い合わせください。");
      return;
    }

    const { data, error: authError } = await supabase.auth.signInWithPassword({
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
          return;
        }

        await supabase
          .from("users_profile")
          .update({ failed_attempts: attempts })
          .eq("email", email);
      }

      setError("ログイン失敗: " + authError.message);
      return;
    }

    // 成功したらリセット
    await supabase
      .from("users_profile")
      .update({ failed_attempts: 0 })
      .eq("email", email);

    router.push("/dashboard");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="bg-white p-6 rounded shadow w-96">
        <h1 className="text-xl mb-4">ログイン</h1>
        <input
          type="email"
          placeholder="メールアドレス"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border p-2 w-full mb-2"
        />
        <input
          type="password"
          placeholder="パスワード"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border p-2 w-full mb-2"
        />
        <button
          onClick={handleLogin}
          className="bg-blue-500 text-white px-4 py-2 w-full rounded"
        >
          ログイン
        </button>
        {error && <p className="text-red-500 mt-2">{error}</p>}
        <p
          className="text-blue-600 mt-4 cursor-pointer"
          onClick={() => router.push("/register")}
        >
          新規登録はこちら
        </p>
      </div>
    </div>
  );
}

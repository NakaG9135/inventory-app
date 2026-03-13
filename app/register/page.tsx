"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleRegister = async () => {
    setError("");

    if (!email || !password || !username) {
      setError("全ての項目を入力してください");
      return;
    }

    // パスワード強度チェック
    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{10,}$/;
    if (!passwordRegex.test(password)) {
      setError("パスワードは大文字・小文字・数字・記号を含み10文字以上にしてください");
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name: username } },
    });

    if (error) {
      setError(error.message);
      return;
    }

    // プロフィール作成
    if (data.user) {
      await supabase.from("users_profile").insert({
        id: data.user.id,
        email,
        name: username,
        failed_attempts: 0,
        locked: false,
      });
    }

    router.push("/login");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="bg-white p-6 rounded shadow w-96">
        <h1 className="text-xl mb-4">新規登録</h1>
        <input
          type="text"
          placeholder="ユーザー名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="border p-2 w-full mb-2"
        />
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
          className="border p-2 w-full mb-1"
        />
        <ul className="text-xs text-gray-500 mb-2 pl-1 space-y-0.5">
          <li>・10文字以上</li>
          <li>・大文字（A〜Z）を含む</li>
          <li>・小文字（a〜z）を含む</li>
          <li>・数字（0〜9）を含む</li>
          <li>・記号（! @ # $ % ^ &amp; *）のいずれかを含む</li>
        </ul>
        <button
          onClick={handleRegister}
          className="bg-green-500 text-white px-4 py-2 w-full rounded"
        >
          登録
        </button>
        {error && <p className="text-red-500 mt-2">{error}</p>}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(false);
  const [duplicateWarnings, setDuplicateWarnings] = useState<string[]>([]);
  const router = useRouter();

  const handleRegister = async () => {
    setError("");

    if (!lastName || !firstName || !email || !password) {
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

    const fullName = `${lastName} ${firstName}`;

    // 重複チェック（同姓同名・メールアドレス）
    const warnings: string[] = [];

    const [{ data: existingName }, { data: existingEmail }] = await Promise.all([
      supabase
        .from("users_profile")
        .select("id")
        .eq("name", fullName)
        .limit(1),
      supabase
        .from("users_profile")
        .select("id")
        .eq("email", email)
        .limit(1),
    ]);

    if (existingName && existingName.length > 0) {
      warnings.push("同じ姓・名（同姓同名）のユーザーが既に登録されています。");
    }

    if (existingEmail && existingEmail.length > 0) {
      warnings.push("このメールアドレスは既に登録されています。別のメールアドレスをお使いください。");
    }

    if (warnings.length > 0) {
      setDuplicateWarnings(warnings);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name: fullName } },
    });

    if (error) {
      setError(error.message);
      return;
    }

    // 既存メールアドレスの場合、identitiesが空になる
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setError("このメールアドレスはすでに登録されています。別のメールアドレスをお使いください。");
      return;
    }

    // プロフィール作成
    if (data.user) {
      await supabase.from("users_profile").insert({
        id: data.user.id,
        email,
        name: fullName,
        failed_attempts: 0,
        locked: false,
      });
    }

    setRegistered(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="bg-white p-6 rounded shadow w-96">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl">新規登録</h1>
          <button
            onClick={() => router.push("/login")}
            className="text-sm text-blue-500 hover:underline"
          >
            ← ログイン画面へ
          </button>
        </div>

        <div className="flex gap-2 mb-2">
          <input
            type="text"
            placeholder="姓（必須）"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="border p-2 w-1/2"
          />
          <input
            type="text"
            placeholder="名（必須）"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="border p-2 w-1/2"
          />
        </div>
        <input
          type="email"
          placeholder="メールアドレス（必須）"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border p-2 w-full mb-2"
        />
        <input
          type="password"
          placeholder="パスワード（必須）"
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

      {/* 重複警告ポップアップ */}
      {duplicateWarnings.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-8 w-96 text-center">
            <div className="text-4xl mb-4">&#x26A0;&#xFE0F;</div>
            <h2 className="text-lg font-bold mb-4 text-red-600">登録できません</h2>
            <div className="text-sm text-gray-700 mb-6 space-y-2">
              {duplicateWarnings.map((w, i) => (
                <p key={i} className="bg-red-50 border border-red-200 rounded p-2 text-red-700">
                  {w}
                </p>
              ))}
            </div>
            <button
              onClick={() => setDuplicateWarnings([])}
              className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-2 rounded w-full"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* 登録完了ポップアップ */}
      {registered && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-8 w-80 text-center">
            <div className="text-4xl mb-4">✉️</div>
            <h2 className="text-lg font-bold mb-2">仮登録が完了しました</h2>
            <p className="text-sm text-gray-600 mb-6">
              <span className="font-semibold">{email}</span> に確認メールを送信しました。<br />
              メール内のURLをクリックして登録を完了してください。
            </p>
            <button
              onClick={() => router.push("/login")}
              className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded w-full"
            >
              ログイン画面へ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function SettingsPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const handleUpdate = async () => {
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setMessage("ログインしてください。");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();

    const userId = userData.user.id;
    const oldEmail = userData.user.email;

    // プロフィール更新
    if (username) {
      const { error } = await supabase
        .from("users_profile")
        .update({ name: username })
        .eq("id", userId);
      if (error) {
        console.error(error);
        setMessage("ユーザー名の更新に失敗しました");
        return;
      }
    }

    // メール更新
    let newEmail = null;
    if (email) {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) {
        console.error(error);
        setMessage("メールアドレスの更新に失敗しました");
        return;
      }
      newEmail = email;
    }

    // パスワード更新
    if (password) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        console.error(error);
        setMessage("パスワードの更新に失敗しました");
        return;
      }
    }

    // 通知メール送信（Edge Function）
    const payload = {
      oldEmail,
      newEmail,
      username: username || userData.user.user_metadata?.username || "",
      userId,
    };

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-profile-update-alert`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session?.access_token}`,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      setMessage("通知メール送信に失敗しました");
      return;
    }

    setUsername("");
    setEmail("");
    setPassword("");
    setMessage("更新が完了しました。通知メールを送信しました。");
  };

  return (
    <div className="p-6">
      <h1 className="text-xl mb-4">登録情報の変更</h1>

      <div className="mb-4">
        <label className="block mb-1">ユーザー名</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="border p-2 w-full"
        />
      </div>

      <div className="mb-4">
        <label className="block mb-1">メールアドレス</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border p-2 w-full"
        />
      </div>

      <div className="mb-4">
        <label className="block mb-1">パスワード</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border p-2 w-full"
        />
      </div>

      <button
        onClick={handleUpdate}
        className="bg-blue-500 text-white px-4 py-2 rounded"
      >
        更新
      </button>

      {message && <p className="mt-4 text-red-500">{message}</p>}
    </div>
  );
}

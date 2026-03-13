"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function ProfilePage() {
  const [user, setUser] = useState<any>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // 現在のユーザー情報を取得
  useEffect(() => {
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
        setEmail(user.email || "");
        // プロフィール名を取得
        const { data } = await supabase.from("users_profile").select("name").eq("id", user.id).single();
        if (data) setUsername(data.name);
      }
    };
    getUser();
  }, []);

  // 登録情報の更新
  const updateProfile = async () => {
    if (!user) return;
    setLoading(true);

    try {
      let changes: string[] = [];

      // ユーザー名変更
      if (username) {
        const { error } = await supabase
          .from("users_profile")
          .update({ name: username })
          .eq("id", user.id);
        if (error) throw error;
        changes.push("ユーザー名");
      }

      // メール変更
      if (email && email !== user.email) {
        const { error } = await supabase.auth.updateUser({ email });
        if (error) throw error;
        changes.push("メールアドレス");
      }

      // パスワード変更
      if (password) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        changes.push("パスワード");
      }

      if (changes.length > 0) {
        alert(`変更を反映しました: ${changes.join("、")}`);
      } else {
        alert("変更がありません");
      }
    } catch (err) {
      console.error(err);
      alert("更新に失敗しました");
    } finally {
      setLoading(false);
    }
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
          placeholder="変更する場合のみ入力"
        />
      </div>

      <button
        onClick={updateProfile}
        disabled={loading}
        className="bg-blue-500 text-white px-4 py-2 rounded"
      >
        {loading ? "更新中..." : "更新する"}
      </button>
    </div>
  );
}

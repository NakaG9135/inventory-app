"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function Sidebar() {
  const [role, setRole] = useState<string>("user");
  const router = useRouter();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  useEffect(() => {
    const fetchRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("users_profile")
          .select("role")
          .eq("id", user.id)
          .single();
        if (data) setRole(data.role);
      }
    };
    fetchRole();
  }, []);

  return (
    <aside className="w-64 bg-gray-800 text-white p-4">
      <h2 className="text-lg font-bold mb-4">メニュー</h2>
      <ul className="space-y-2">
        <li>
          <Link href="/dashboard/inventory" className="block hover:bg-gray-700 p-2 rounded">
            在庫一覧
          </Link>
        </li>
        <li>
          <Link href="/dashboard/profile" className="block hover:bg-gray-700 p-2 rounded">
            登録情報変更
          </Link>
        </li>
        {role === "admin" && (
          <>
            <li>
              <Link href="/dashboard/logs" className="block hover:bg-gray-700 p-2 rounded">
                入出庫ログ
              </Link>
            </li>
            <li>
              <Link href="/dashboard/master" className="block hover:bg-gray-700 p-2 rounded">
                商品マスタ編集
              </Link>
            </li>
            <li>
              <Link href="/dashboard/settings" className="block hover:bg-gray-700 p-2 rounded">
                システム設定
              </Link>
            </li>
          </>
        )}
      </ul>
      <button
        onClick={handleLogout}
        className="mt-6 w-full bg-red-600 hover:bg-red-700 text-white p-2 rounded"
      >
        ログアウト
      </button>
    </aside>
  );
}

"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter, usePathname } from "next/navigation";

export default function Sidebar() {
  const [role, setRole] = useState<string>("user");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

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

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const links = [
    { href: "/dashboard/inventory", label: "在庫一覧", adminOnly: false },
    { href: "/dashboard/reserves", label: "材料確保", adminOnly: false },
    { href: "/dashboard/report", label: "日報", adminOnly: false },
    { href: "/dashboard/report-drafts", label: "一時保存した日報", adminOnly: false },
    { href: "/dashboard/report-logs", label: "日報ログ", adminOnly: false },
    { href: "/dashboard/profile", label: "登録情報変更", adminOnly: false },
    { href: "/dashboard/logs", label: "入出庫ログ", adminOnly: true },
    { href: "/dashboard/master", label: "商品マスタ編集", adminOnly: true },
    { href: "/dashboard/vehicles", label: "車両管理", adminOnly: true },
    { href: "/dashboard/workers", label: "作業員名簿", adminOnly: true },
    { href: "/dashboard/settings", label: "システム設定", adminOnly: true },
  ];

  const visibleLinks = links.filter((l) => !l.adminOnly || role === "admin");

  return (
    <>
      {/* モバイル用ハンバーガーボタン */}
      <button
        className="md:hidden fixed top-3 left-3 z-50 bg-gray-800 text-white p-2 rounded"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "✕" : "☰"}
      </button>

      {/* オーバーレイ */}
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-30"
          onClick={() => setOpen(false)}
        />
      )}

      {/* サイドバー本体 */}
      <aside
        className={`
          fixed md:static top-0 left-0 h-full z-40
          w-56 bg-gray-800 text-white p-4 flex flex-col overflow-y-auto
          transform transition-transform duration-200
          ${open ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0
        `}
      >
        <h2 className="text-lg font-bold mb-4">メニュー</h2>
        <ul className="space-y-2 flex-1">
          {visibleLinks.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className={`block hover:bg-gray-700 p-2 rounded ${pathname === l.href ? "bg-gray-600" : ""}`}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <button
          onClick={handleLogout}
          className="mt-6 w-full bg-red-600 hover:bg-red-700 text-white p-2 rounded"
        >
          ログアウト
        </button>
      </aside>
    </>
  );
}

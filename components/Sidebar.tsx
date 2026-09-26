"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter, usePathname } from "next/navigation";
import { usePermissions } from "@/components/PermissionsProvider";
import { LEVEL_VIEW, PAGES, type PageKey } from "@/lib/permissions";

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { can } = usePermissions();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const pageLink = (key: PageKey) => {
    const page = PAGES.find((p) => p.key === key)!;
    return { href: page.href, label: page.label, show: can(key, LEVEL_VIEW) };
  };

  const links = [
    pageLink("inventory"),
    pageLink("reserves"),
    pageLink("lending"),
    pageLink("sites"),
    pageLink("report"),
    { href: "/dashboard/report-drafts", label: "一時保存した日報", show: can("report", LEVEL_VIEW) },
    pageLink("report_logs"),
    { href: "/dashboard/profile", label: "登録情報変更", show: true },
    pageLink("material_prices"),
    pageLink("logs"),
    pageLink("master"),
    pageLink("vehicles"),
    pageLink("workers"),
    pageLink("settings"),
    pageLink("permissions"),
    pageLink("operation_logs"),
    pageLink("employees"),
  ];

  const visibleLinks = links.filter((l) => l.show);

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
        <h2 className="text-lg font-bold mb-4 mt-10 md:mt-0">メニュー</h2>
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

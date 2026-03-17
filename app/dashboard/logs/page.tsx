"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import withAdminRoute from "@/components/withAdminRoute";

function LogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [filters, setFilters] = useState({
    username: "",
    type: "",
    maker: "",
    detail: "",
    site_name: "",
    date: "",
  });

  const fetchLogs = async () => {
    let query = supabase
      .from("inventory_logs")
      .select(
        `
        id,
        change_type,
        quantity,
        company_name,
        site_name,
        created_at,
        inventory!item_id(type, maker, detail, unit),
        users_profile!user_id(name)
      `
      )
      .order("created_at", { ascending: false });

    if (filters.date) {
      query = query.gte("created_at", `${filters.date} 00:00:00`);
      query = query.lte("created_at", `${filters.date} 23:59:59`);
    }

    const { data, error } = await query;

    if (error) {
      console.error(error);
    } else {
      let filtered = data || [];
      if (filters.username) {
        filtered = filtered.filter((log: any) =>
          log.users_profile?.name?.toLowerCase().includes(filters.username.toLowerCase())
        );
      }
      if (filters.type) {
        filtered = filtered.filter((log: any) =>
          log.inventory?.type?.toLowerCase().includes(filters.type.toLowerCase())
        );
      }
      if (filters.maker) {
        filtered = filtered.filter((log: any) =>
          log.inventory?.maker?.toLowerCase().includes(filters.maker.toLowerCase())
        );
      }
      if (filters.detail) {
        filtered = filtered.filter((log: any) =>
          log.inventory?.detail?.toLowerCase().includes(filters.detail.toLowerCase())
        );
      }
      if (filters.site_name) {
        filtered = filtered.filter((log: any) =>
          log.site_name?.toLowerCase().includes(filters.site_name.toLowerCase())
        );
      }
      setLogs(filtered);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-xl mb-4">入出庫ログ（管理者専用）</h1>

      {/* 検索フォーム */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <input
          type="text"
          placeholder="ユーザー名"
          value={filters.username}
          onChange={(e) => setFilters({ ...filters, username: e.target.value })}
          className="border p-2"
        />
        <input
          type="text"
          placeholder="種類"
          value={filters.type}
          onChange={(e) => setFilters({ ...filters, type: e.target.value })}
          className="border p-2"
        />
        <input
          type="text"
          placeholder="メーカー"
          value={filters.maker}
          onChange={(e) => setFilters({ ...filters, maker: e.target.value })}
          className="border p-2"
        />
        <input
          type="text"
          placeholder="詳細"
          value={filters.detail}
          onChange={(e) => setFilters({ ...filters, detail: e.target.value })}
          className="border p-2"
        />
        <input
          type="text"
          placeholder="現場名"
          value={filters.site_name}
          onChange={(e) => setFilters({ ...filters, site_name: e.target.value })}
          className="border p-2"
        />
        <input
          type="date"
          value={filters.date}
          onChange={(e) => setFilters({ ...filters, date: e.target.value })}
          className="border p-2"
        />
      </div>

      <button
        onClick={fetchLogs}
        className="bg-blue-500 text-white px-4 py-2 rounded mb-4"
      >
        検索
      </button>

      {/* ログ一覧 */}
      <div className="overflow-x-auto">
      <table className="table-auto border-collapse border text-sm">
        <thead>
          <tr>
            <th className="border px-4 py-2 whitespace-nowrap w-1">ユーザー</th>
            <th className="border px-4 py-2 whitespace-nowrap w-1">種類</th>
            <th className="border px-4 py-2 whitespace-nowrap w-1">メーカー</th>
            <th className="border px-4 py-2 whitespace-nowrap w-1">詳細</th>
            <th className="border px-4 py-2 whitespace-nowrap w-1">入出庫</th>
            <th className="border px-4 py-2 whitespace-nowrap w-1">数量</th>
            <th className="border px-4 py-2 whitespace-nowrap w-1">会社名</th>
            <th className="border px-4 py-2 whitespace-nowrap w-1">現場名</th>
            <th className="border px-4 py-2 whitespace-nowrap w-1">日時</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td className="border px-4 py-2 whitespace-nowrap w-1">{log.users_profile?.name}</td>
              <td className="border px-4 py-2 whitespace-nowrap w-1">{log.inventory?.type}</td>
              <td className="border px-4 py-2 whitespace-nowrap w-1">{log.inventory?.maker}</td>
              <td className="border px-4 py-2 whitespace-nowrap w-1">{log.inventory?.detail}</td>
              <td className="border px-4 py-2 whitespace-nowrap w-1">
                {log.change_type === "in" ? "入庫" : "出庫"}
              </td>
              <td className="border px-4 py-2 whitespace-nowrap w-1">
                {log.quantity} {log.inventory?.unit}
              </td>
              <td className="border px-4 py-2 whitespace-nowrap w-1">{log.company_name || "-"}</td>
              <td className="border px-4 py-2 whitespace-nowrap w-1">{log.site_name || "-"}</td>
              <td className="border px-4 py-2 whitespace-nowrap w-1">
                {new Date(log.created_at.endsWith("Z") || log.created_at.includes("+") ? log.created_at : log.created_at + "Z").toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export default withAdminRoute(LogsPage);

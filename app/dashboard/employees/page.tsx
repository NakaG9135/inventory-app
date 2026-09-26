"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { usePermissions } from "@/components/PermissionsProvider";
import { LEVEL_OPERATE, LEVEL_VIEW } from "@/lib/permissions";
import { ageFrom, fmtDate, fmtDateTime, serviceLength, type Employee } from "@/lib/employees";

type LastAccess = { user_id: string; last_at: string; ip: string; device_type: string; os: string; os_version: string };

export default function EmployeesPage() {
  const router = useRouter();
  const { can } = usePermissions();
  const canView = can("employees", LEVEL_VIEW);
  const canEdit = can("employees", LEVEL_OPERATE);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [qualCounts, setQualCounts] = useState<Record<string, string[]>>({});
  const [lastAccess, setLastAccess] = useState<Record<string, LastAccess>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!canView) return;
    (async () => {
      const [emp, quals, access] = await Promise.all([
        supabase.from("employees").select("*").order("department").order("name"),
        supabase.from("employee_qualifications").select("employee_id, name"),
        supabase.rpc("employee_last_access"),
      ]);
      if (emp.error) {
        setError(`読み込みに失敗しました: ${emp.error.message}`);
        setLoading(false);
        return;
      }
      setEmployees((emp.data ?? []) as Employee[]);
      const q: Record<string, string[]> = {};
      for (const r of (quals.data ?? []) as { employee_id: string; name: string }[]) {
        (q[r.employee_id] ??= []).push(r.name);
      }
      setQualCounts(q);
      const a: Record<string, LastAccess> = {};
      for (const r of (access.data ?? []) as LastAccess[]) a[r.user_id] = r;
      setLastAccess(a);
      setLoading(false);
    })();
  }, [canView]);

  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/[\s　]+/).filter(Boolean);
    return employees.filter((e) => {
      if (!showRetired && e.leave_date) return false;
      if (dept && e.department !== dept) return false;
      if (terms.length === 0) return true;
      const hay = [e.name, e.name_kana, e.department, e.position, e.employment_type, e.phone, e.email,
        e.current_address, e.notes, ...(qualCounts[e.id] ?? [])].join(" ").toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [employees, query, dept, showRetired, qualCounts]);

  const departments = useMemo(() => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))), [employees]);

  const addEmployee = async () => {
    setCreating(true);
    const { data, error } = await supabase.from("employees").insert({ name: "新しい従業員" }).select("id").single();
    setCreating(false);
    if (error || !data) {
      alert(`追加に失敗しました: ${error?.message ?? ""}`);
      return;
    }
    router.push(`/dashboard/employees/${data.id}`);
  };

  if (!canView) return null;
  if (loading) return <p>読み込み中...</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-bold">従業員名簿</h1>
        {canEdit && (
          <button onClick={addEmployee} disabled={creating} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
            ＋ 従業員を追加
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 flex flex-wrap gap-2 items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名前・ふりがな・役職・資格・住所などで検索（スペースで絞り込み）"
          className="border rounded p-2 text-sm flex-1 min-w-[220px]"
        />
        <select value={dept} onChange={(e) => setDept(e.target.value)} className="border rounded p-2 text-sm bg-white">
          <option value="">すべての部署</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <label className="text-sm flex items-center gap-1">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          退職者も表示
        </label>
        <span className="text-sm text-gray-500 ml-auto">{filtered.length}人</span>
      </div>

      <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
        <table className="text-sm min-w-full">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="p-2 text-left whitespace-nowrap">名前</th>
              <th className="p-2 text-left whitespace-nowrap">部署・役職</th>
              <th className="p-2 text-right whitespace-nowrap">年齢</th>
              <th className="p-2 text-left whitespace-nowrap">入社日</th>
              <th className="p-2 text-left whitespace-nowrap">勤続</th>
              <th className="p-2 text-left whitespace-nowrap">免許・資格</th>
              <th className="p-2 text-left whitespace-nowrap">最終接続</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const la = e.user_id ? lastAccess[e.user_id] : undefined;
              const age = ageFrom(e.birth_date);
              return (
                <tr key={e.id} className="border-t border-gray-200 hover:bg-blue-50">
                  <td className="p-2 whitespace-nowrap">
                    <Link href={`/dashboard/employees/${e.id}`} className="font-medium text-blue-700 hover:underline">{e.name || "（名前未設定）"}</Link>
                    {e.name_kana && <div className="text-xs text-gray-400">{e.name_kana}</div>}
                    {e.leave_date && <span className="text-xs text-red-600 ml-1">退職</span>}
                    {!e.user_id && <span className="text-xs text-gray-400 ml-1">（アカウントなし）</span>}
                  </td>
                  <td className="p-2 whitespace-nowrap">{[e.department, e.position].filter(Boolean).join(" ") || "—"}</td>
                  <td className="p-2 text-right whitespace-nowrap">{age !== null ? `${age}歳` : "—"}</td>
                  <td className="p-2 whitespace-nowrap">{fmtDate(e.hire_date) || "—"}</td>
                  <td className="p-2 whitespace-nowrap">{serviceLength(e.hire_date, e.leave_date) || "—"}</td>
                  <td className="p-2 text-xs text-gray-600 max-w-[220px] truncate" title={(qualCounts[e.id] ?? []).join("、")}>
                    {(qualCounts[e.id] ?? []).join("、") || "—"}
                  </td>
                  <td className="p-2 whitespace-nowrap text-xs text-gray-600">
                    {la ? <>{fmtDateTime(la.last_at)}<div className="text-gray-400">{la.device_type} {la.os} {la.os_version}</div></> : "—"}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-gray-400">該当する従業員はいません</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

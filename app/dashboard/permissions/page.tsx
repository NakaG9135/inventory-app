"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { usePermissions } from "@/components/PermissionsProvider";
import {
  LEVEL_LABELS,
  PAGES,
  type PageKey,
  type PermissionLevel,
} from "@/lib/permissions";

type MatrixRow = {
  user_id: string;
  name: string;
  email: string | null;
  role: string;
  is_super_admin: boolean;
  page_key: PageKey;
  level: PermissionLevel;
  default_level: PermissionLevel;
};

type Account = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  isSuperAdmin: boolean;
  levels: Record<string, PermissionLevel>;
  defaults: Record<string, PermissionLevel>;
};

const LEVELS: PermissionLevel[] = [0, 1, 2, 3];

const LEVEL_STYLES: Record<PermissionLevel, { active: string; cell: string }> = {
  0: { active: "bg-gray-600 text-white border-gray-600", cell: "bg-gray-100 text-gray-500" },
  1: { active: "bg-sky-600 text-white border-sky-600", cell: "bg-sky-100 text-sky-800" },
  2: { active: "bg-green-600 text-white border-green-600", cell: "bg-green-100 text-green-800" },
  3: { active: "bg-orange-600 text-white border-orange-600", cell: "bg-orange-100 text-orange-800" },
};

export default function PermissionsPage() {
  const { isSuperAdmin } = usePermissions();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchMatrix = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_permission_matrix");
    if (error) {
      setError(`読み込みに失敗しました: ${error.message}`);
      setLoading(false);
      return;
    }
    const map = new Map<string, Account>();
    for (const row of (data ?? []) as MatrixRow[]) {
      let acc = map.get(row.user_id);
      if (!acc) {
        acc = {
          id: row.user_id,
          name: row.name || "(名前未設定)",
          email: row.email,
          role: row.role,
          isSuperAdmin: row.is_super_admin,
          levels: {},
          defaults: {},
        };
        map.set(row.user_id, acc);
      }
      acc.levels[row.page_key] = row.level;
      acc.defaults[row.page_key] = row.default_level;
    }
    const list = Array.from(map.values());
    setAccounts(list);
    setError(null);
    setLoading(false);
    setSelectedId((cur) => cur ?? list.find((a) => !a.isSuperAdmin)?.id ?? list[0]?.id ?? null);
  }, []);

  useEffect(() => {
    if (isSuperAdmin) fetchMatrix();
  }, [isSuperAdmin, fetchMatrix]);

  const selected = useMemo(() => accounts.find((a) => a.id === selectedId) ?? null, [accounts, selectedId]);

  const updateLocal = (userId: string, pageKey: PageKey, level: PermissionLevel) => {
    setAccounts((prev) =>
      prev.map((a) => (a.id === userId ? { ...a, levels: { ...a.levels, [pageKey]: level } } : a))
    );
  };

  const setLevel = async (acc: Account, pageKey: PageKey, level: PermissionLevel) => {
    const before = acc.levels[pageKey];
    if (before === level) return;
    setSaving(`${acc.id}:${pageKey}`);
    setMessage(null);
    updateLocal(acc.id, pageKey, level);
    const { error } = await supabase.rpc("set_page_permission", {
      p_user: acc.id,
      p_page: pageKey,
      p_level: level,
    });
    setSaving(null);
    if (error) {
      updateLocal(acc.id, pageKey, before);
      setMessage(`保存に失敗しました: ${error.message}`);
    }
  };

  const resetToDefault = async (acc: Account) => {
    if (!confirm(`${acc.name} の権限をすべて初期値（${acc.role === "admin" ? "管理者" : "一般"}の標準）に戻しますか？`)) return;
    setSaving(`${acc.id}:all`);
    setMessage(null);
    const results = await Promise.all(
      PAGES.map((p) => supabase.rpc("set_page_permission", { p_user: acc.id, p_page: p.key, p_level: null }))
    );
    setSaving(null);
    const failed = results.find((r) => r.error);
    if (failed?.error) setMessage(`一部の保存に失敗しました: ${failed.error.message}`);
    await fetchMatrix();
  };

  if (!isSuperAdmin) return null;
  if (loading) return <p>読み込み中...</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">権限管理</h1>
      <p className="text-sm text-gray-600 mb-4">
        アカウントごとに各ページの権限を設定します。変更はすぐに保存され、相手の画面にもその場で反映されます。
      </p>

      <div className="flex flex-wrap gap-2 text-xs mb-4">
        {LEVELS.map((l) => (
          <span key={l} className={`px-2 py-1 rounded ${LEVEL_STYLES[l].cell}`}>
            {LEVEL_LABELS[l]}
            {l === 0 && "：メニューに出ない"}
            {l === 1 && "：見るだけ"}
            {l === 2 && "：日常の操作ができる"}
            {l === 3 && "：修正・削除など全てできる"}
          </span>
        ))}
      </div>

      {message && <p className="mb-3 p-2 rounded bg-red-100 text-red-700 text-sm">{message}</p>}

      <div className="grid md:grid-cols-[240px_1fr] gap-4">
        {/* アカウント一覧 */}
        <div className="bg-white border rounded-lg overflow-hidden h-fit">
          <div className="md:hidden p-2">
            <select
              className="w-full border rounded p-2"
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.isSuperAdmin ? "（最上位管理者）" : a.role === "admin" ? "（管理者）" : ""}
                </option>
              ))}
            </select>
          </div>
          <ul className="hidden md:block divide-y">
            {accounts.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => setSelectedId(a.id)}
                  className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${a.id === selectedId ? "bg-blue-50 border-l-4 border-blue-600" : ""}`}
                >
                  <div className="font-medium text-sm">{a.name}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {a.isSuperAdmin ? "最上位管理者" : a.role === "admin" ? "管理者" : "一般"}
                    {a.email ? ` ・ ${a.email}` : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* 選択中アカウントの権限 */}
        {selected && (
          <div className="bg-white border rounded-lg p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-lg font-bold">{selected.name}</h2>
                <p className="text-xs text-gray-500">
                  {selected.email}
                  {" ・ "}
                  {selected.isSuperAdmin ? "最上位管理者" : selected.role === "admin" ? "管理者" : "一般"}
                </p>
              </div>
              {!selected.isSuperAdmin && (
                <button
                  onClick={() => resetToDefault(selected)}
                  disabled={saving !== null}
                  className="text-sm px-3 py-1 rounded border hover:bg-gray-50 disabled:opacity-50"
                >
                  すべて初期値に戻す
                </button>
              )}
            </div>

            {selected.isSuperAdmin ? (
              <p className="text-sm text-gray-600">最上位管理者は常にすべてのページを「編集」できます。変更はできません。</p>
            ) : (
              <ul className="divide-y">
                {PAGES.map((page) => {
                  const current = selected.levels[page.key] ?? 0;
                  const isDefault = current === selected.defaults[page.key];
                  const busy = saving === `${selected.id}:${page.key}` || saving === `${selected.id}:all`;
                  const desc =
                    current === 0 ? "メニューに表示されず、開けません"
                    : current === 1 ? page.levels.view
                    : current === 2 ? page.levels.operate
                    : page.levels.edit;
                  return (
                    <li key={page.key} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="sm:w-44 shrink-0">
                        <div className="font-medium">{page.label}</div>
                        <div className="text-xs text-gray-500">
                          {desc}
                          {!isDefault && <span className="ml-1 text-orange-600">（変更済み）</span>}
                        </div>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {LEVELS.map((l) => (
                          <button
                            key={l}
                            onClick={() => setLevel(selected, page.key, l)}
                            disabled={busy}
                            className={`px-3 py-1 rounded border text-sm min-w-16 ${
                              current === l ? LEVEL_STYLES[l].active : "bg-white hover:bg-gray-50"
                            } disabled:opacity-60`}
                          >
                            {LEVEL_LABELS[l]}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 一覧表 */}
      <h2 className="text-lg font-bold mt-8 mb-2">全アカウントの権限一覧</h2>
      <div className="overflow-x-auto bg-white border rounded-lg">
        <table className="text-xs min-w-full">
          <thead>
            <tr className="bg-gray-50">
              <th className="p-2 text-left sticky left-0 bg-gray-50 whitespace-nowrap">アカウント</th>
              {PAGES.map((p) => (
                <th key={p.key} className="p-2 whitespace-nowrap">{p.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr
                key={a.id}
                className={`border-t cursor-pointer hover:bg-gray-50 ${a.id === selectedId ? "outline outline-2 outline-blue-500" : ""}`}
                onClick={() => setSelectedId(a.id)}
              >
                <td className="p-2 sticky left-0 bg-white whitespace-nowrap font-medium">{a.name}</td>
                {PAGES.map((p) => {
                  const l = a.levels[p.key] ?? 0;
                  return (
                    <td key={p.key} className="p-1 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded ${LEVEL_STYLES[l].cell}`}>
                        {LEVEL_LABELS[l]}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

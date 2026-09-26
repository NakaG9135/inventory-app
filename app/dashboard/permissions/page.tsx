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
  preset_key: string | null;
  page_key: PageKey;
  level: PermissionLevel;
  override_level: PermissionLevel | null;
  preset_level: PermissionLevel;
};

type Account = {
  id: string;
  name: string;
  email: string | null;
  isSuperAdmin: boolean;
  presetKey: string | null;
  levels: Record<string, PermissionLevel>;
  overrides: Record<string, PermissionLevel | null>;
};

type Preset = {
  key: string;
  department: "office" | "construction";
  label: string;
  levels: Record<string, PermissionLevel>;
};

const LEVELS: PermissionLevel[] = [0, 1, 2, 3];

const LEVEL_STYLES: Record<PermissionLevel, { active: string; cell: string }> = {
  0: { active: "bg-gray-600 text-white border-gray-600", cell: "bg-gray-100 text-gray-500" },
  1: { active: "bg-sky-600 text-white border-sky-600", cell: "bg-sky-100 text-sky-800" },
  2: { active: "bg-green-600 text-white border-green-600", cell: "bg-green-100 text-green-800" },
  3: { active: "bg-orange-600 text-white border-orange-600", cell: "bg-orange-100 text-orange-800" },
};

const levelDescription = (pageKey: PageKey, level: PermissionLevel) => {
  const page = PAGES.find((p) => p.key === pageKey)!;
  if (level === 0) return "メニューに表示されず、開けません";
  if (level === 1) return page.levels.view;
  if (level === 2) return page.levels.operate;
  return page.levels.edit;
};

function LevelButtons({
  current,
  disabled,
  onChange,
}: {
  current: PermissionLevel;
  disabled: boolean;
  onChange: (l: PermissionLevel) => void;
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {LEVELS.map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          disabled={disabled}
          className={`px-3 py-1 rounded border text-sm min-w-16 ${
            current === l ? LEVEL_STYLES[l].active : "bg-white hover:bg-gray-50"
          } disabled:opacity-60`}
        >
          {LEVEL_LABELS[l]}
        </button>
      ))}
    </div>
  );
}

export default function PermissionsPage() {
  const { isSuperAdmin } = usePermissions();
  const [tab, setTab] = useState<"accounts" | "presets">("accounts");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>("office");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const [matrixRes, presetRes, presetLevelRes] = await Promise.all([
      supabase.rpc("get_permission_matrix"),
      supabase.from("permission_presets").select("key, department, label, sort_order").order("sort_order"),
      supabase.from("permission_preset_levels").select("preset_key, page_key, level"),
    ]);
    const err = matrixRes.error || presetRes.error || presetLevelRes.error;
    if (err) {
      setError(`読み込みに失敗しました: ${err.message}`);
      setLoading(false);
      return;
    }

    const map = new Map<string, Account>();
    for (const row of (matrixRes.data ?? []) as MatrixRow[]) {
      let acc = map.get(row.user_id);
      if (!acc) {
        acc = {
          id: row.user_id,
          name: row.name || "(名前未設定)",
          email: row.email,
          isSuperAdmin: row.is_super_admin,
          presetKey: row.preset_key,
          levels: {},
          overrides: {},
        };
        map.set(row.user_id, acc);
      }
      acc.levels[row.page_key] = row.level;
      acc.overrides[row.page_key] = row.override_level;
    }
    const list = Array.from(map.values());

    const levelMap = new Map<string, Record<string, PermissionLevel>>();
    for (const row of (presetLevelRes.data ?? []) as { preset_key: string; page_key: string; level: PermissionLevel }[]) {
      if (!levelMap.has(row.preset_key)) levelMap.set(row.preset_key, {});
      levelMap.get(row.preset_key)![row.page_key] = row.level;
    }
    setPresets(
      ((presetRes.data ?? []) as Omit<Preset, "levels">[]).map((p) => ({ ...p, levels: levelMap.get(p.key) ?? {} }))
    );
    setAccounts(list);
    setError(null);
    setLoading(false);
    setSelectedId((cur) => cur ?? list.find((a) => !a.isSuperAdmin)?.id ?? list[0]?.id ?? null);
  }, []);

  useEffect(() => {
    if (isSuperAdmin) fetchAll();
  }, [isSuperAdmin, fetchAll]);

  const presetByKey = useMemo(() => new Map(presets.map((p) => [p.key, p])), [presets]);
  const selected = useMemo(() => accounts.find((a) => a.id === selectedId) ?? null, [accounts, selectedId]);
  const editingPreset = presetByKey.get(selectedPreset) ?? null;

  const accountTitle = (a: Account) => {
    if (a.isSuperAdmin) return "社長";
    const p = a.presetKey ? presetByKey.get(a.presetKey) : null;
    return p ? p.label : "未設定";
  };

  const run = async (key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setSaving(key);
    setMessage(null);
    const { error } = await fn();
    if (error) setMessage(`保存に失敗しました: ${error.message}`);
    await fetchAll();
    setSaving(null);
  };

  const setAccountLevel = (acc: Account, pageKey: PageKey, level: PermissionLevel | null) =>
    run(`${acc.id}:${pageKey}`, () =>
      supabase.rpc("set_page_permission", { p_user: acc.id, p_page: pageKey, p_level: level })
    );

  const setAccountPreset = (acc: Account, presetKey: string) => {
    const preset = presetByKey.get(presetKey);
    const current = acc.presetKey ? presetByKey.get(acc.presetKey) : null;
    if (preset && current && preset.department !== current.department) {
      if (!confirm(`${acc.name} を「${current.label}」から「${preset.label}」に変更します。部署が変わるため、作業員一覧などへの表示も変わります。よろしいですか？`)) return;
    }
    return run(`${acc.id}:preset`, () => supabase.rpc("set_user_preset", { p_user: acc.id, p_preset: presetKey }));
  };

  const resetAccountToPreset = async (acc: Account) => {
    if (!confirm(`${acc.name} の個別設定をすべて解除し、プリセット「${accountTitle(acc)}」の通りに戻しますか？`)) return;
    setSaving(`${acc.id}:all`);
    setMessage(null);
    const targets = PAGES.filter((p) => acc.overrides[p.key] !== null && acc.overrides[p.key] !== undefined);
    const results = await Promise.all(
      targets.map((p) => supabase.rpc("set_page_permission", { p_user: acc.id, p_page: p.key, p_level: null }))
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) setMessage(`一部の保存に失敗しました: ${failed.error.message}`);
    await fetchAll();
    setSaving(null);
  };

  const setPresetLevel = (preset: Preset, pageKey: PageKey, level: PermissionLevel) =>
    run(`preset:${preset.key}:${pageKey}`, () =>
      supabase.rpc("set_preset_level", { p_preset: preset.key, p_page: pageKey, p_level: level })
    );

  if (!isSuperAdmin) return null;
  if (loading) return <p>読み込み中...</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  const officePresets = presets.filter((p) => p.department === "office");
  const constructionPresets = presets.filter((p) => p.department === "construction");
  const overrideCount = (a: Account) => PAGES.filter((p) => a.overrides[p.key] !== null && a.overrides[p.key] !== undefined).length;

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">権限管理</h1>
      <p className="text-sm text-gray-600 mb-4">
        各アカウントにプリセット（総務部事務・総務部経理・工事部作業員・工事部主任・工事部課長・工事部次長・工事部部長）を割り当て、必要ならページごとに個別に変更できます。変更はすぐに保存され、相手の画面にもその場で反映されます。
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

      <div className="flex gap-1 border-b mb-4">
        {([
          ["accounts", "アカウント別"],
          ["presets", "プリセットの設定"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === key ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {message && <p className="mb-3 p-2 rounded bg-red-100 text-red-700 text-sm">{message}</p>}

      {tab === "accounts" && (
        <>
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
                      {a.name}（{accountTitle(a)}）
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
                        {accountTitle(a)}
                        {overrideCount(a) > 0 && <span className="text-orange-600">・個別設定 {overrideCount(a)}件</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* 選択中アカウント */}
            {selected && (
              <div className="bg-white border rounded-lg p-4">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                  <div>
                    <h2 className="text-lg font-bold">{selected.name}</h2>
                    <p className="text-xs text-gray-500">{selected.email}</p>
                  </div>
                  {!selected.isSuperAdmin && overrideCount(selected) > 0 && (
                    <button
                      onClick={() => resetAccountToPreset(selected)}
                      disabled={saving !== null}
                      className="text-sm px-3 py-1 rounded border hover:bg-gray-50 disabled:opacity-50"
                    >
                      個別設定をすべて解除
                    </button>
                  )}
                </div>

                {selected.isSuperAdmin ? (
                  <p className="text-sm text-gray-600">社長は常にすべてのページを「編集」できます。変更はできません。</p>
                ) : (
                  <>
                    <div className="mb-4 p-3 rounded bg-gray-50 border">
                      <label className="text-sm font-medium block mb-1">プリセット</label>
                      <select
                        className="border rounded p-2 w-full sm:w-64 bg-white"
                        value={selected.presetKey ?? ""}
                        disabled={saving !== null}
                        onChange={(e) => setAccountPreset(selected, e.target.value)}
                      >
                        {!selected.presetKey && <option value="">未設定</option>}
                        <optgroup label="総務部">
                          {officePresets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                        </optgroup>
                        <optgroup label="工事部">
                          {constructionPresets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                        </optgroup>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        下の各ページはプリセットの通りになります。ボタンで変えたページだけ「個別設定」になり、プリセットより優先されます。
                      </p>
                    </div>

                    <ul className="divide-y">
                      {PAGES.map((page) => {
                        const current = selected.levels[page.key] ?? 0;
                        const override = selected.overrides[page.key];
                        const isOverride = override !== null && override !== undefined;
                        const busy = saving === `${selected.id}:${page.key}` || saving === `${selected.id}:all` || saving === `${selected.id}:preset`;
                        return (
                          <li key={page.key} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                            <div className="sm:w-52 shrink-0">
                              <div className="font-medium">{page.label}</div>
                              <div className="text-xs text-gray-500">{levelDescription(page.key, current)}</div>
                              {isOverride ? (
                                <div className="text-xs">
                                  <span className="text-orange-600">個別設定</span>
                                  <button
                                    onClick={() => setAccountLevel(selected, page.key, null)}
                                    disabled={busy}
                                    className="ml-2 text-blue-600 hover:underline disabled:opacity-50"
                                  >
                                    プリセットに戻す
                                  </button>
                                </div>
                              ) : (
                                <div className="text-xs text-gray-400">プリセット通り</div>
                              )}
                            </div>
                            <LevelButtons
                              current={current}
                              disabled={busy}
                              onChange={(l) => { if (l !== current) setAccountLevel(selected, page.key, l); }}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </>
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
                  <th className="p-2 text-left whitespace-nowrap">プリセット</th>
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
                    <td className="p-2 whitespace-nowrap text-gray-600">{accountTitle(a)}</td>
                    {PAGES.map((p) => {
                      const l = a.levels[p.key] ?? 0;
                      const isOverride = a.overrides[p.key] !== null && a.overrides[p.key] !== undefined;
                      return (
                        <td key={p.key} className="p-1 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded ${LEVEL_STYLES[l].cell} ${isOverride ? "ring-2 ring-orange-400" : ""}`}
                            title={isOverride ? "個別設定" : "プリセット通り"}
                          >
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
          <p className="text-xs text-gray-500 mt-1">オレンジの枠は個別設定です。</p>
        </>
      )}

      {tab === "presets" && (
        <div className="grid md:grid-cols-[240px_1fr] gap-4">
          <div className="bg-white border rounded-lg overflow-hidden h-fit">
            {([
              ["総務部", officePresets],
              ["工事部", constructionPresets],
            ] as const).map(([dept, list]) => (
              <div key={dept}>
                <div className="px-3 py-1 text-xs font-bold text-gray-500 bg-gray-50 border-b">{dept}</div>
                <ul className="divide-y">
                  {list.map((p) => {
                    const count = accounts.filter((a) => a.presetKey === p.key).length;
                    return (
                      <li key={p.key}>
                        <button
                          onClick={() => setSelectedPreset(p.key)}
                          className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${p.key === selectedPreset ? "bg-blue-50 border-l-4 border-blue-600" : ""}`}
                        >
                          <div className="font-medium text-sm">{p.label}</div>
                          <div className="text-xs text-gray-500">{count}人</div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {editingPreset && (
            <div className="bg-white border rounded-lg p-4">
              <h2 className="text-lg font-bold">{editingPreset.label}</h2>
              <p className="text-xs text-gray-500 mb-3">
                変更すると、このプリセットのアカウント（{accounts.filter((a) => a.presetKey === editingPreset.key).map((a) => a.name).join("、") || "なし"}）にすぐ反映されます。個別設定したページはそちらが優先されます。
              </p>
              <ul className="divide-y">
                {PAGES.map((page) => {
                  const current = (editingPreset.levels[page.key] ?? 0) as PermissionLevel;
                  return (
                    <li key={page.key} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="sm:w-52 shrink-0">
                        <div className="font-medium">{page.label}</div>
                        <div className="text-xs text-gray-500">{levelDescription(page.key, current)}</div>
                      </div>
                      <LevelButtons
                        current={current}
                        disabled={saving !== null}
                        onChange={(l) => { if (l !== current) setPresetLevel(editingPreset, page.key, l); }}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

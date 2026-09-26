"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type FieldDef = {
  key: string;
  label: string;
  type: "text" | "date" | "number" | "select" | "textarea";
  options?: { value: string; label: string }[];
  placeholder?: string;
};

type Row = Record<string, unknown> & { id: string };

// 従業員に紐づく一覧（子供・緊急連絡先・車両・資格・慶弔金・休暇）の追加・編集・削除
export default function EmployeeSubTable({
  table,
  employeeId,
  fields,
  canEdit,
  orderBy,
  render,
  summary,
  addLabel = "追加",
}: {
  table: string;
  employeeId: string;
  fields: FieldDef[];
  canEdit: boolean;
  orderBy: { column: string; ascending: boolean };
  render: (row: Row) => React.ReactNode;
  summary?: (rows: Row[]) => React.ReactNode;
  addLabel?: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from(table)
      .select("*")
      .eq("employee_id", employeeId)
      .order(orderBy.column, { ascending: orderBy.ascending, nullsFirst: false });
    setRows((data ?? []) as Row[]);
  }, [table, employeeId, orderBy.column, orderBy.ascending]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (row: Row | null) => {
    const f: Record<string, string> = {};
    for (const fd of fields) {
      const v = row ? row[fd.key] : "";
      f[fd.key] = v === null || v === undefined ? "" : String(v);
    }
    setForm(f);
    setEditingId(row ? row.id : "new");
  };

  const save = async () => {
    setSaving(true);
    const payload: Record<string, unknown> = {};
    for (const fd of fields) {
      const v = form[fd.key] ?? "";
      payload[fd.key] = fd.type === "date" || fd.type === "number" ? (v === "" ? null : fd.type === "number" ? Number(v) : v) : v;
    }
    const { error } = editingId === "new"
      ? await supabase.from(table).insert({ ...payload, employee_id: employeeId })
      : await supabase.from(table).update(payload).eq("id", editingId);
    setSaving(false);
    if (error) {
      alert(`保存に失敗しました: ${error.message}`);
      return;
    }
    setEditingId(null);
    load();
  };

  const remove = async (row: Row) => {
    if (!confirm("削除しますか？")) return;
    const { error } = await supabase.from(table).delete().eq("id", row.id);
    if (error) alert(`削除に失敗しました: ${error.message}`);
    load();
  };

  const inputCls = "border rounded p-2 text-sm w-full bg-white";

  const formView = (
    <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 mb-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map((fd) => (
          <div key={fd.key} className={fd.type === "textarea" ? "sm:col-span-2" : ""}>
            <label className="text-xs text-gray-600 block mb-1">{fd.label}</label>
            {fd.type === "select" ? (
              <select value={form[fd.key] ?? ""} onChange={(e) => setForm({ ...form, [fd.key]: e.target.value })} className={inputCls}>
                {fd.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : fd.type === "textarea" ? (
              <textarea value={form[fd.key] ?? ""} onChange={(e) => setForm({ ...form, [fd.key]: e.target.value })} rows={2} className={inputCls} placeholder={fd.placeholder} />
            ) : (
              <input
                type={fd.type}
                value={form[fd.key] ?? ""}
                onChange={(e) => setForm({ ...form, [fd.key]: e.target.value })}
                className={inputCls}
                placeholder={fd.placeholder}
                step={fd.type === "number" ? "any" : undefined}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={save} disabled={saving} className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50">
          {saving ? "保存中…" : "保存"}
        </button>
        <button onClick={() => setEditingId(null)} className="border px-4 py-1.5 rounded text-sm bg-white">キャンセル</button>
      </div>
    </div>
  );

  return (
    <div>
      {summary && rows.length > 0 && <div className="mb-3">{summary(rows)}</div>}
      {canEdit && editingId !== "new" && (
        <button onClick={() => startEdit(null)} className="mb-3 text-sm bg-white border border-blue-300 text-blue-700 px-3 py-1.5 rounded hover:bg-blue-50">
          ＋ {addLabel}
        </button>
      )}
      {editingId === "new" && formView}
      {rows.length === 0 && editingId !== "new" && <p className="text-sm text-gray-400">登録されていません</p>}
      <ul className="space-y-2">
        {rows.map((row) =>
          editingId === row.id ? (
            <li key={row.id}>{formView}</li>
          ) : (
            <li key={row.id} className="border border-gray-200 rounded-lg p-3 flex gap-3 items-start">
              <div className="flex-1 text-sm">{render(row)}</div>
              {canEdit && (
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => startEdit(row)} className="text-xs text-blue-600 hover:underline">編集</button>
                  <button onClick={() => remove(row)} className="text-xs text-red-500 hover:underline">削除</button>
                </div>
              )}
            </li>
          )
        )}
      </ul>
    </div>
  );
}

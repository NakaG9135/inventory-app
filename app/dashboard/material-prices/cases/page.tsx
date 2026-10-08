"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import QuoteConditionsForm from "@/components/QuoteConditionsForm";
import { usePermissions } from "@/components/PermissionsProvider";
import { LEVEL_EDIT, LEVEL_OPERATE } from "@/lib/permissions";
import { conditionParts, parseCaseWorkbook, type CaseConditions, type QuoteCase, type QuoteCaseInfo } from "@/lib/quote/cases";
import { deleteCase, fetchCaseInfos, insertCase, updateCaseInfo } from "@/lib/quote/caseStore";

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const input = "border rounded px-2 py-1 text-sm w-full";

type Pending = { key: string; quoteCase: QuoteCase; warnings: string[]; saving: boolean; error: string };

// 件名・見積日・メモと条件の入力欄（登録前の確認と、登録後の修正で共通）
function CaseFields<T extends QuoteCaseInfo>({ value, onChange }: { value: T; onChange: (v: T) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-[1fr_10rem] gap-3">
        <label className="text-sm">
          件名
          <input className={input} value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} />
        </label>
        <label className="text-sm">
          見積日
          <input type="date" className={input} value={value.quoteDate ?? ""} onChange={(e) => onChange({ ...value, quoteDate: e.target.value || null })} />
        </label>
      </div>
      <QuoteConditionsForm value={value} onChange={(c: CaseConditions) => onChange({ ...value, ...c })} />
      <label className="text-sm block">
        メモ（この見積りの特徴など。例：発電機から、ハウス移設あり）
        <input className={input} value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} />
      </label>
    </div>
  );
}

export default function QuoteCasesPage() {
  const { can } = usePermissions();
  // 操作: 登録・条件の修正 / 編集: 削除
  const canOperate = can("material_prices", LEVEL_OPERATE);
  const canEdit = can("material_prices", LEVEL_EDIT);

  const [cases, setCases] = useState<QuoteCaseInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [editing, setEditing] = useState<QuoteCaseInfo | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [filter, setFilter] = useState("");

  const reload = useCallback(async () => {
    try {
      setCases(await fetchCaseInfos());
      setLoadError(null);
    } catch (e) {
      setLoadError(`見積り事例の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const registeredFiles = useMemo(() => new Set(cases.map((c) => c.sourceFile).filter(Boolean)), [cases]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added: Pending[] = [];
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const { quoteCase, warnings } = parseCaseWorkbook(await file.arrayBuffer(), file.name);
        added.push({ key: `${file.name}-${Date.now()}-${added.length}`, quoteCase, warnings, saving: false, error: "" });
      } catch (e) {
        errors.push(`${file.name}: 読み込めませんでした（${e instanceof Error ? e.message : String(e)}）`);
      }
    }
    setPending((p) => [...p.filter((x) => !added.some((a) => a.quoteCase.sourceFile === x.quoteCase.sourceFile)), ...added]);
    setFileErrors(errors);
  };

  const updatePending = (key: string, patch: Partial<Pending>) => setPending((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const savePending = async (p: Pending): Promise<boolean> => {
    updatePending(p.key, { saving: true, error: "" });
    try {
      await insertCase(p.quoteCase);
      setPending((ps) => ps.filter((x) => x.key !== p.key));
      return true;
    } catch (e) {
      updatePending(p.key, { saving: false, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  const saveAllPending = async () => {
    for (const p of pending.filter((x) => !registeredFiles.has(x.quoteCase.sourceFile))) await savePending(p);
    await reload();
  };

  const saveEdit = async () => {
    if (!editing?.id) return;
    setSavingEdit(true);
    try {
      await updateCaseInfo(editing.id, editing);
      setEditing(null);
      await reload();
    } catch (e) {
      alert(`保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (c: QuoteCaseInfo) => {
    if (!c.id || !confirm(`「${c.title}」を見積り事例から削除しますか？\n（元のExcelファイルや材料単価は消えません）`)) return;
    try {
      await deleteCase(c.id);
      await reload();
    } catch (e) {
      alert(`削除に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const shown = useMemo(() => {
    const words = filter.normalize("NFKC").toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return cases;
    return cases.filter((c) => {
      const hay = [c.title, c.client, c.sourceFile, c.note, ...conditionParts(c)].join(" ").normalize("NFKC").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [cases, filter]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-2xl font-bold">見積り事例</h1>
        <Link href="/dashboard/material-prices/quote" className="bg-green-600 text-white text-sm px-4 py-2 rounded hover:bg-green-700">
          似た見積りから作る
        </Link>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        過去の見積り（最終版のExcel：表紙「見積書」＋「内訳」）を、工事種類・ハウスの大きさ・引込容量などの条件と一緒に登録しておくと、
        「見積り作成」で新しい現場の条件に近い見積りを探して、その品目と数量を下書きに使えます。
      </p>

      {canOperate && (
        <section className="bg-white border rounded-lg p-4 mb-4">
          <h2 className="font-bold mb-2">過去の見積りを登録する</h2>
          <label className="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 cursor-pointer text-sm">
            Excelファイルを選択（複数可）
            <input
              type="file"
              accept=".xlsx,.xls"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <p className="text-xs text-gray-500 mt-2">
            条件はファイルの件名・品目の規格（「シングル平屋」「SB4KVA契約」など）から推測しています。違っていたら直してから登録してください。
            ファイル名が「2026-2-26-件名.xlsx」の形なら見積日も入ります。
          </p>
          {fileErrors.map((m, i) => <p key={i} className="text-sm text-red-600 mt-1">・{m}</p>)}

          {pending.length > 0 && (
            <div className="mt-4 space-y-4">
              {pending.map((p) => {
                const dup = registeredFiles.has(p.quoteCase.sourceFile);
                const itemCount = p.quoteCase.groups.reduce((t, g) => t + g.items.length, 0);
                return (
                  <div key={p.key} className={`border rounded-lg p-3 ${dup ? "bg-gray-50" : "bg-blue-50/40"}`}>
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                      <div className="text-sm">
                        <span className="font-bold">{p.quoteCase.sourceFile}</span>
                        <span className="text-gray-600 ml-2">
                          {p.quoteCase.client && `${p.quoteCase.client} ／ `}税抜 {yen(p.quoteCase.subtotal)} ／ 工事区分 {p.quoteCase.groups.length} ・品目 {itemCount}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                          disabled={dup || p.saving}
                          onClick={async () => {
                            if (await savePending(p)) await reload();
                          }}
                        >
                          {p.saving ? "登録中..." : "登録"}
                        </button>
                        <button type="button" className="text-sm text-gray-600 hover:underline" onClick={() => setPending((ps) => ps.filter((x) => x.key !== p.key))}>
                          取り消し
                        </button>
                      </div>
                    </div>
                    {dup && <p className="text-sm text-orange-700 mb-2">このファイルは登録済みです（条件を直す時は下の一覧から）。</p>}
                    <p className="text-xs text-gray-600 mb-2">工事区分：{p.quoteCase.groups.map((g) => g.name).join("、") || "なし"}</p>
                    {p.warnings.map((w, i) => <p key={i} className="text-sm text-orange-700 mb-1">・{w}</p>)}
                    {p.error && <p className="text-sm text-red-600 mb-1">・{p.error}</p>}
                    {!dup && <CaseFields value={p.quoteCase} onChange={(v) => updatePending(p.key, { quoteCase: v })} />}
                  </div>
                );
              })}
              {pending.filter((p) => !registeredFiles.has(p.quoteCase.sourceFile)).length > 1 && (
                <button type="button" className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700" onClick={saveAllPending}>
                  まとめて登録（{pending.filter((p) => !registeredFiles.has(p.quoteCase.sourceFile)).length}件）
                </button>
              )}
            </div>
          )}
        </section>
      )}

      <section className="bg-white border rounded-lg p-4 mb-10">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="font-bold">登録済みの見積り（{cases.length}件）</h2>
          <input className="border rounded px-2 py-1 text-sm w-64" placeholder="件名・宛先・条件で絞り込み" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {loadError && <p className="text-sm text-red-600 mb-2">{loadError}</p>}
        {loading ? (
          <p className="text-sm text-gray-500">読み込み中...</p>
        ) : cases.length === 0 ? (
          <p className="text-sm text-gray-500">まだ登録されていません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="p-2 border whitespace-nowrap">見積日</th>
                  <th className="p-2 border">件名</th>
                  <th className="p-2 border">条件</th>
                  <th className="p-2 border text-right whitespace-nowrap">税抜小計</th>
                  {(canOperate || canEdit) && <th className="p-2 border"></th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((c) =>
                  editing?.id === c.id ? (
                    <tr key={c.id}>
                      <td className="p-3 border bg-blue-50/40" colSpan={canOperate || canEdit ? 5 : 4}>
                        <CaseFields value={editing} onChange={setEditing} />
                        <div className="flex gap-2 mt-3">
                          <button
                            type="button"
                            className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                            disabled={savingEdit}
                            onClick={saveEdit}
                          >
                            {savingEdit ? "保存中..." : "保存"}
                          </button>
                          <button type="button" className="text-sm text-gray-600 hover:underline" onClick={() => setEditing(null)}>
                            やめる
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={c.id} className="align-top">
                      <td className="p-2 border whitespace-nowrap">{c.quoteDate ?? "-"}</td>
                      <td className="p-2 border">
                        <div>{c.title}</div>
                        <div className="text-xs text-gray-500">{c.client}</div>
                        {c.note && <div className="text-xs text-gray-600 mt-0.5">{c.note}</div>}
                      </td>
                      <td className="p-2 border">
                        <div className="flex flex-wrap gap-1">
                          {conditionParts(c).map((part, i) => (
                            <span key={i} className="bg-gray-100 rounded px-1.5 py-0.5 text-xs whitespace-nowrap">{part}</span>
                          ))}
                          {conditionParts(c).length === 0 && <span className="text-xs text-orange-700">条件が未入力です</span>}
                        </div>
                      </td>
                      <td className="p-2 border text-right whitespace-nowrap">{yen(c.subtotal)}</td>
                      {(canOperate || canEdit) && (
                        <td className="p-2 border whitespace-nowrap">
                          {canOperate && (
                            <button type="button" className="text-xs text-blue-600 hover:underline mr-3" onClick={() => setEditing({ ...c })}>
                              条件を直す
                            </button>
                          )}
                          {canEdit && (
                            <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => handleDelete(c)}>
                              削除
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

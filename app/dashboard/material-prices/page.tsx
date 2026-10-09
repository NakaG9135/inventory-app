"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { usePermissions } from "@/components/PermissionsProvider";
import { LEVEL_EDIT, LEVEL_OPERATE, LEVEL_VIEW } from "@/lib/permissions";
import { isFuzzyMatch } from "@/lib/fuzzyMatch";

interface MaterialPrice {
  id: string;
  category: string;
  name: string;
  specification: string;
  unit: string;
  unit_price: number;
  source_file: string;
  updated_at: string;
}

const PAGE_SIZE = 50;
const TABS = [
  { key: "材料費", label: "材料費" },
  { key: "労務費", label: "労務費" },
  { key: "その他", label: "その他" },
] as const;


export default function MaterialPricesPage() {
  const { can } = usePermissions();
  // 操作: Excel取込・手動追加 / 編集: 削除・重複/類似の整理
  const canOperate = can("material_prices", LEVEL_OPERATE);
  const canEdit = can("material_prices", LEVEL_EDIT);
  const [activeTab, setActiveTab] = useState<string>("材料費");
  const [items, setItems] = useState<MaterialPrice[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [searchName, setSearchName] = useState("");
  const [searchSpec, setSearchSpec] = useState("");
  const [sortKey, setSortKey] = useState<keyof MaterialPrice>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [loading, setLoading] = useState(false);

  // ユーザー名（操作権限判定用）

  // インポート関連
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);

  // 重複管理
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [duplicates, setDuplicates] = useState<{ name: string; specification: string; count: number; items: MaterialPrice[] }[]>([]);
  const [loadingDuplicates, setLoadingDuplicates] = useState(false);

  // 類似チェック
  const [showSimilar, setShowSimilar] = useState(false);
  const [similarGroups, setSimilarGroups] = useState<{ names: string[]; items: MaterialPrice[] }[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);

  // 手動追加
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addSpec, setAddSpec] = useState("");
  const [addUnit, setAddUnit] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("material_prices")
      .select("*", { count: "exact" })
      .eq("category", activeTab);

    if (searchName.trim()) query = query.ilike("name", `%${searchName.trim()}%`);
    if (searchSpec.trim()) query = query.ilike("specification", `%${searchSpec.trim()}%`);

    query = query.order(sortKey, { ascending: sortAsc });

    const from = page * PAGE_SIZE;
    query = query.range(from, from + PAGE_SIZE - 1);

    const { data, count, error } = await query;
    if (!error) {
      setItems((data || []) as MaterialPrice[]);
      setTotalCount(count || 0);
    }
    setLoading(false);
  }, [activeTab, searchName, searchSpec, sortKey, sortAsc, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setShowDuplicates(false);
  }, [activeTab, searchName, searchSpec]);

  const handleSort = (key: keyof MaterialPrice) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
    setPage(0);
  };

  const handleImport = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).filter((f) => /\.(xlsx|xls)$/i.test(f.name) && !f.name.startsWith("~$"));
    if (files.length === 0) {
      setImportResult({ error: "Excelファイル(.xlsx/.xls)を選択してください" });
      return;
    }
    if (!confirm(`選択した${files.length}件のExcelファイルから取込みます。\n\nよろしいですか？`)) return;

    setImporting(true);
    setImportResult(null);

    let newFiles = 0;
    let skippedFiles = 0;
    let insertedCount = 0;
    let materialCount = 0;
    let laborCount = 0;
    let otherCount = 0;
    const fileErrors: string[] = [];
    const insertErrors: string[] = [];
    const zeroRecordFiles: { fileName: string; diagnostics: { sheet: string; rowCount: number; sampleRows: string[] }[] }[] = [];

    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Vercelのリクエストサイズ上限を避けるため1ファイルずつ送信
      for (const file of files) {
        try {
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch("/api/material-prices/import", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${session?.access_token}`,
            },
            body: formData,
          });
          const result = await res.json().catch(() => ({ error: `サーバーエラー (${res.status})` }));

          if (!res.ok || result.error) {
            fileErrors.push(`${file.name}: ${result.error ?? `エラー (${res.status})`}`);
            if (res.status === 401 || res.status === 403) break;
            continue;
          }
          if (result.skipped) {
            skippedFiles++;
            continue;
          }
          if (result.fileError) fileErrors.push(`${file.name}: ${result.fileError}`);
          if (Array.isArray(result.insertErrors)) insertErrors.push(...result.insertErrors);
          if (Array.isArray(result.diagnostics)) zeroRecordFiles.push({ fileName: file.name, diagnostics: result.diagnostics });
          newFiles++;
          insertedCount += result.insertedCount ?? 0;
          materialCount += result.materialCount ?? 0;
          laborCount += result.laborCount ?? 0;
          otherCount += result.otherCount ?? 0;
        } catch (err) {
          fileErrors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      setImportResult({
        message: newFiles === 0 && fileErrors.length === 0
          ? "新しいファイルはありません（全て取込済み）"
          : `${insertedCount}件を取込みました（材料費: ${materialCount}件 / 労務費: ${laborCount}件 / その他: ${otherCount}件）`,
        totalFiles: files.length,
        newFiles,
        skippedFiles,
        insertedCount,
        fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
        insertErrors: insertErrors.length > 0 ? insertErrors : undefined,
        zeroRecordFiles: zeroRecordFiles.length > 0 ? zeroRecordFiles : undefined,
      });
      fetchData();
    } catch (err) {
      setImportResult({ error: `取込エラー: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    const { error } = await supabase.from("material_prices").delete().eq("id", id);
    if (error) {
      alert("削除に失敗しました: " + error.message);
    } else {
      fetchData();
      if (showDuplicates) findDuplicates();
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm(`${activeTab}のデータを全件削除しますか？この操作は取り消せません。`)) return;
    if (!confirm("本当に全件削除してもよろしいですか？")) return;
    const { error } = await supabase.from("material_prices").delete().eq("category", activeTab);
    if (error) {
      alert("削除に失敗しました: " + error.message);
    } else {
      fetchData();
      setDuplicates([]);
    }
  };

  // 重複検出: 同じ名称+規格が2件以上あるものを取得
  const findDuplicates = async () => {
    setLoadingDuplicates(true);
    setShowDuplicates(true);

    // 全件取得して重複を検出
    const { data, error } = await supabase
      .from("material_prices")
      .select("*")
      .eq("category", activeTab)
      .order("name", { ascending: true })
      .order("unit_price", { ascending: false });

    if (error || !data) {
      setLoadingDuplicates(false);
      return;
    }

    // 名称+規格でグルーピング
    const groups = new Map<string, MaterialPrice[]>();
    for (const item of data as MaterialPrice[]) {
      const key = `${item.name}|||${item.specification}`;
      const list = groups.get(key) || [];
      list.push(item);
      groups.set(key, list);
    }

    // 2件以上あるグループのみ
    const dupList = Array.from(groups.entries())
      .filter(([, items]) => items.length >= 2)
      .map(([, items]) => ({
        name: items[0].name,
        specification: items[0].specification,
        count: items.length,
        items: items.sort((a, b) => b.unit_price - a.unit_price), // 高い順
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));

    setDuplicates(dupList);
    setLoadingDuplicates(false);
  };

  // 重複グループで最高単価以外を一括削除
  const handleKeepHighest = async (group: { name: string; specification: string; items: MaterialPrice[] }) => {
    const toKeep = group.items[0]; // 単価最高（ソート済み）
    const toDelete = group.items.slice(1);
    if (!confirm(`「${group.name}」の重複${toDelete.length}件を削除し、単価 ¥${Number(toKeep.unit_price).toLocaleString("ja-JP")} のみ残しますか？`)) return;

    const ids = toDelete.map((d) => d.id);
    const { error } = await supabase.from("material_prices").delete().in("id", ids);
    if (error) {
      alert("削除に失敗しました: " + error.message);
    } else {
      findDuplicates();
      fetchData();
    }
  };

  // 全重複を一括処理（各グループの最高単価のみ残す）
  const handleKeepAllHighest = async () => {
    if (duplicates.length === 0) return;
    const totalToDelete = duplicates.reduce((s, g) => s + g.items.length - 1, 0);
    if (!confirm(`${duplicates.length}グループの重複から${totalToDelete}件を削除し、各グループの最高単価のみ残しますか？`)) return;

    const idsToDelete: string[] = [];
    for (const group of duplicates) {
      for (let i = 1; i < group.items.length; i++) {
        idsToDelete.push(group.items[i].id);
      }
    }

    // バッチ削除
    const BATCH = 200;
    for (let i = 0; i < idsToDelete.length; i += BATCH) {
      const batch = idsToDelete.slice(i, i + BATCH);
      const { error } = await supabase.from("material_prices").delete().in("id", batch);
      if (error) {
        alert(`削除エラー: ${error.message}`);
        break;
      }
    }

    findDuplicates();
    fetchData();
  };

  // 類似チェック: 名称が類似（完全一致除く）のグループを検出
  const findSimilar = async () => {
    setLoadingSimilar(true);
    setShowSimilar(true);

    const { data, error } = await supabase
      .from("material_prices")
      .select("*")
      .eq("category", activeTab)
      .order("name", { ascending: true });

    if (error || !data) {
      setLoadingSimilar(false);
      return;
    }

    const allItems = data as MaterialPrice[];
    // ユニークな名称を取得
    const uniqueNames = Array.from(new Set(allItems.map((i) => i.name)));

    // 名称同士をfuzzyMatchで比較し、類似グループを構築
    const visited = new Set<string>();
    const groups: { names: string[]; items: MaterialPrice[] }[] = [];

    for (let i = 0; i < uniqueNames.length; i++) {
      if (visited.has(uniqueNames[i])) continue;
      const similarNames = [uniqueNames[i]];
      for (let j = i + 1; j < uniqueNames.length; j++) {
        if (visited.has(uniqueNames[j])) continue;
        if (uniqueNames[i] === uniqueNames[j]) continue; // 完全一致は重複チェック側
        if (isFuzzyMatch(uniqueNames[i], uniqueNames[j])) {
          similarNames.push(uniqueNames[j]);
          visited.add(uniqueNames[j]);
        }
      }
      if (similarNames.length >= 2) {
        visited.add(uniqueNames[i]);
        const groupItems = allItems
          .filter((item) => similarNames.includes(item.name))
          .sort((a, b) => b.unit_price - a.unit_price);
        groups.push({ names: similarNames, items: groupItems });
      }
    }

    groups.sort((a, b) => a.names[0].localeCompare(b.names[0], "ja"));
    setSimilarGroups(groups);
    setLoadingSimilar(false);
  };

  // 手動追加処理
  const handleManualAdd = async () => {
    if (!addName.trim()) { alert("名称を入力してください"); return; }
    const price = parseFloat(addPrice);
    if (isNaN(price) || price < 0) { alert("単価を正しく入力してください"); return; }

    setAddSubmitting(true);
    const { error } = await supabase.from("material_prices").insert({
      category: activeTab,
      name: addName.trim(),
      specification: addSpec.trim(),
      unit: addUnit.trim(),
      unit_price: price,
      source_file: "手動追加",
    });

    if (error) {
      alert("追加に失敗しました: " + error.message);
    } else {
      setAddName("");
      setAddSpec("");
      setAddUnit("");
      setAddPrice("");
      fetchData();
    }
    setAddSubmitting(false);
  };

  const sortIcon = (key: keyof MaterialPrice) => {
    if (sortKey !== key) return "";
    return sortAsc ? " ▲" : " ▼";
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const fromIdx = page * PAGE_SIZE + 1;
  const toIdx = Math.min((page + 1) * PAGE_SIZE, totalCount);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-2xl font-bold">材料単価</h1>
        {can("quotes", LEVEL_VIEW) && (
          <Link href="/dashboard/material-prices/quote" className="bg-green-600 text-white text-sm px-4 py-2 rounded hover:bg-green-700">
            この単価で見積りを作る
          </Link>
        )}
      </div>

      {/* インポートセクション */}
      {canOperate && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-4 flex-wrap">
            <label
              className={`bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 ${importing ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}
            >
              {importing ? "取込中..." : "Excelファイルを選択して取込"}
              <input
                type="file"
                accept=".xlsx,.xls"
                multiple
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  handleImport(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <span className="text-sm text-gray-600">
              Excelの内訳シートから材料費・労務費を自動分類して取込（複数選択可・取込済みファイルは自動スキップ）
            </span>
          </div>

          {importResult && (
            <div className={`mt-3 p-3 rounded text-sm ${importResult.error ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
              {importResult.error ? (
                <p>{String(importResult.error)}</p>
              ) : (
                <div>
                  <p className="font-bold">{String(importResult.message)}</p>
                  <p>
                    選択ファイル: {String(importResult.totalFiles)}件
                    {importResult.newFiles !== undefined && ` / 新規: ${String(importResult.newFiles)}件`}
                    {importResult.skippedFiles !== undefined && Number(importResult.skippedFiles) > 0 && ` / 取込済みスキップ: ${String(importResult.skippedFiles)}件`}
                    {` / 取込件数: ${String(importResult.insertedCount)}`}
                  </p>
                  {Array.isArray(importResult.fileErrors) && importResult.fileErrors.length > 0 && (
                    <div className="mt-1 text-red-600">
                      <p>ファイルエラー:</p>
                      {(importResult.fileErrors as string[]).map((e: string, i: number) => <p key={i}>・{e}</p>)}
                    </div>
                  )}
                  {Array.isArray(importResult.zeroRecordFiles) && importResult.zeroRecordFiles.length > 0 && (
                    <div className="mt-2 text-orange-700">
                      <p className="font-bold">単価が読み取れなかったファイル（B列=名称、F列=単価 の行を取込みます）:</p>
                      {(importResult.zeroRecordFiles as { fileName: string; diagnostics: { sheet: string; rowCount: number; sampleRows: string[] }[] }[]).map((f, i) => (
                        <div key={i} className="mt-1">
                          <p>・{f.fileName}</p>
                          {f.diagnostics.map((d, j) => (
                            <div key={j} className="ml-3 mt-1">
                              <p>シート「{d.sheet}」（{d.rowCount}行）の先頭:</p>
                              <pre className="text-xs bg-white/70 p-2 rounded overflow-x-auto whitespace-pre">{d.sampleRows.join("\n") || "（空）"}</pre>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  {Array.isArray(importResult.insertErrors) && importResult.insertErrors.length > 0 && (
                    <div className="mt-1 text-red-600">
                      <p>挿入エラー:</p>
                      {(importResult.insertErrors as string[]).map((e: string, i: number) => <p key={i}>・{e}</p>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* タブ */}
      <div className="flex border-b mb-4">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-blue-600 text-blue-600 bg-blue-50"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 検索バー + 操作ボタン */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <input
          type="text"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          placeholder="名称で検索..."
          className="border rounded p-2 flex-1 min-w-[150px]"
        />
        <input
          type="text"
          value={searchSpec}
          onChange={(e) => setSearchSpec(e.target.value)}
          placeholder="規格で検索..."
          className="border rounded p-2 flex-1 min-w-[150px]"
        />
        <span className="text-sm text-gray-500 self-center">
          {totalCount}件
        </span>
        {canEdit && (
          <>
            <button
              onClick={findDuplicates}
              className="bg-yellow-500 text-white px-3 py-1 rounded text-sm hover:bg-yellow-600"
            >
              重複チェック
            </button>
            <button
              onClick={findSimilar}
              className="bg-purple-500 text-white px-3 py-1 rounded text-sm hover:bg-purple-600"
            >
              類似チェック
            </button>
            <button
              onClick={handleDeleteAll}
              className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600"
            >
              {activeTab}全件削除
            </button>
          </>
        )}
        {canOperate && (
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="bg-green-500 text-white px-3 py-1 rounded text-sm hover:bg-green-600"
          >
            {showAddForm ? "追加フォーム閉じる" : "手動追加"}
          </button>
        )}
      </div>

      {/* 手動追加フォーム */}
      {canOperate && showAddForm && (
        <div className="mb-4 border border-green-300 rounded-lg bg-green-50 p-4">
          <h3 className="font-bold text-green-800 mb-3">手動追加（{activeTab}）</h3>
          <div className="flex gap-2 flex-wrap items-end">
            <div className="flex-1 min-w-[150px]">
              <label className="text-xs text-gray-500 block mb-1">名称 *</label>
              <input type="text" value={addName} onChange={(e) => setAddName(e.target.value)}
                placeholder="名称" className="border rounded p-2 w-full" />
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="text-xs text-gray-500 block mb-1">規格</label>
              <input type="text" value={addSpec} onChange={(e) => setAddSpec(e.target.value)}
                placeholder="規格" className="border rounded p-2 w-full" />
            </div>
            <div className="w-20">
              <label className="text-xs text-gray-500 block mb-1">単位</label>
              <input type="text" value={addUnit} onChange={(e) => setAddUnit(e.target.value)}
                placeholder="m, 個" className="border rounded p-2 w-full" />
            </div>
            <div className="w-28">
              <label className="text-xs text-gray-500 block mb-1">単価 *</label>
              <input type="number" value={addPrice} onChange={(e) => setAddPrice(e.target.value)}
                placeholder="0" min="0" className="border rounded p-2 w-full" />
            </div>
            <button onClick={handleManualAdd} disabled={addSubmitting}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50">
              {addSubmitting ? "追加中..." : "追加"}
            </button>
          </div>
        </div>
      )}

      {/* 重複管理パネル */}
      {canEdit && showDuplicates && (
        <div className="mb-4 border border-yellow-300 rounded-lg bg-yellow-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-yellow-800">
              重複チェック結果（{activeTab}）
              {!loadingDuplicates && ` — ${duplicates.length}グループ`}
            </h3>
            <div className="flex gap-2">
              {duplicates.length > 0 && (
                <button
                  onClick={handleKeepAllHighest}
                  className="bg-orange-500 text-white px-3 py-1 rounded text-sm hover:bg-orange-600"
                >
                  全グループ最高単価のみ残す
                </button>
              )}
              <button
                onClick={() => setShowDuplicates(false)}
                className="text-gray-500 hover:text-gray-700 px-2"
              >
                閉じる
              </button>
            </div>
          </div>

          {loadingDuplicates ? (
            <p className="text-gray-500">検索中...</p>
          ) : duplicates.length === 0 ? (
            <p className="text-green-700">重複はありません</p>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {duplicates.map((group, gi) => (
                <div key={gi} className="bg-white border rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-bold">{group.name}</span>
                      {group.specification && <span className="text-gray-500 ml-2">({group.specification})</span>}
                      <span className="ml-2 text-sm text-red-600">{group.count}件重複</span>
                    </div>
                    <button
                      onClick={() => handleKeepHighest(group)}
                      className="bg-orange-400 text-white px-2 py-1 rounded text-xs hover:bg-orange-500"
                    >
                      最高単価のみ残す
                    </button>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs">
                        <th className="text-left p-1">単価</th>
                        <th className="text-left p-1">単位</th>
                        <th className="text-left p-1">取込元</th>
                        <th className="text-center p-1">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item, idx) => (
                        <tr key={item.id} className={idx === 0 ? "bg-green-50" : ""}>
                          <td className="p-1">
                            ¥{Number(item.unit_price).toLocaleString("ja-JP")}
                            {idx === 0 && <span className="text-green-600 text-xs ml-1">(最高)</span>}
                          </td>
                          <td className="p-1">{item.unit}</td>
                          <td className="p-1 text-xs text-gray-500">{item.source_file}</td>
                          <td className="p-1 text-center">
                            <button
                              onClick={() => handleDelete(item.id, item.name)}
                              className="text-red-500 hover:text-red-700 text-xs"
                            >
                              削除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 類似チェックパネル */}
      {canEdit && showSimilar && (
        <div className="mb-4 border border-purple-300 rounded-lg bg-purple-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-purple-800">
              類似チェック結果（{activeTab}）
              {!loadingSimilar && ` — ${similarGroups.length}グループ`}
            </h3>
            <button
              onClick={() => setShowSimilar(false)}
              className="text-gray-500 hover:text-gray-700 px-2"
            >
              閉じる
            </button>
          </div>

          {loadingSimilar ? (
            <p className="text-gray-500">検索中...</p>
          ) : similarGroups.length === 0 ? (
            <p className="text-green-700">類似項目はありません</p>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {similarGroups.map((group, gi) => (
                <div key={gi} className="bg-white border rounded p-3">
                  <div className="mb-2">
                    <span className="text-sm text-purple-700 font-bold">類似名称: </span>
                    {group.names.map((n, ni) => (
                      <span key={ni}>
                        {ni > 0 && <span className="text-gray-400 mx-1">≈</span>}
                        <span className="bg-purple-100 px-1 rounded">{n}</span>
                      </span>
                    ))}
                    <span className="ml-2 text-sm text-gray-500">({group.items.length}件)</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs">
                        <th className="text-left p-1">名称</th>
                        <th className="text-left p-1">規格</th>
                        <th className="text-left p-1">単位</th>
                        <th className="text-right p-1">単価</th>
                        <th className="text-left p-1">取込元</th>
                        <th className="text-center p-1">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item) => (
                        <tr key={item.id} className="hover:bg-gray-50">
                          <td className="p-1">{item.name}</td>
                          <td className="p-1">{item.specification}</td>
                          <td className="p-1">{item.unit}</td>
                          <td className="p-1 text-right">¥{Number(item.unit_price).toLocaleString("ja-JP")}</td>
                          <td className="p-1 text-xs text-gray-500">{item.source_file}</td>
                          <td className="p-1 text-center">
                            <button
                              onClick={() => handleDelete(item.id, item.name)}
                              className="text-red-500 hover:text-red-700 text-xs"
                            >
                              削除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* テーブル */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse bg-white rounded shadow text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th
                className="border p-2 text-left cursor-pointer hover:bg-gray-200 whitespace-nowrap"
                onClick={() => handleSort("name")}
              >
                名称{sortIcon("name")}
              </th>
              <th
                className="border p-2 text-left cursor-pointer hover:bg-gray-200 whitespace-nowrap"
                onClick={() => handleSort("specification")}
              >
                規格{sortIcon("specification")}
              </th>
              <th
                className="border p-2 text-left cursor-pointer hover:bg-gray-200 whitespace-nowrap"
                onClick={() => handleSort("unit")}
              >
                単位{sortIcon("unit")}
              </th>
              <th
                className="border p-2 text-right cursor-pointer hover:bg-gray-200 whitespace-nowrap"
                onClick={() => handleSort("unit_price")}
              >
                単価{sortIcon("unit_price")}
              </th>
              <th
                className="border p-2 text-left cursor-pointer hover:bg-gray-200 whitespace-nowrap"
                onClick={() => handleSort("source_file")}
              >
                取込元{sortIcon("source_file")}
              </th>
              {canEdit && <th className="border p-2 text-center whitespace-nowrap">操作</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={canEdit ? 6 : 5} className="border p-4 text-center text-gray-400">読込中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={canEdit ? 6 : 5} className="border p-4 text-center text-gray-400">データがありません</td></tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="border p-2">{item.name}</td>
                  <td className="border p-2">{item.specification}</td>
                  <td className="border p-2">{item.unit}</td>
                  <td className="border p-2 text-right">¥{Number(item.unit_price).toLocaleString("ja-JP")}</td>
                  <td className="border p-2 text-xs text-gray-500">{item.source_file}</td>
                  {canEdit && (
                    <td className="border p-2 text-center">
                      <button
                        onClick={() => handleDelete(item.id, item.name)}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        削除
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ページネーション */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-gray-600">
            {totalCount}件中 {fromIdx}〜{toIdx}件
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1 border rounded text-sm disabled:opacity-30 hover:bg-gray-100"
            >
              前へ
            </button>
            <span className="self-center text-sm">{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 border rounded text-sm disabled:opacity-30 hover:bg-gray-100"
            >
              次へ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


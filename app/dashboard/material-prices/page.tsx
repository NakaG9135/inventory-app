"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import withAdminRoute from "@/components/withAdminRoute";

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
] as const;

function MaterialPricesPage() {
  const [activeTab, setActiveTab] = useState<string>("材料費");
  const [items, setItems] = useState<MaterialPrice[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [searchName, setSearchName] = useState("");
  const [searchSpec, setSearchSpec] = useState("");
  const [sortKey, setSortKey] = useState<keyof MaterialPrice>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [loading, setLoading] = useState(false);

  // インポート関連
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);

  // 重複管理
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [duplicates, setDuplicates] = useState<{ name: string; specification: string; count: number; items: MaterialPrice[] }[]>([]);
  const [loadingDuplicates, setLoadingDuplicates] = useState(false);

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

  const handleImport = async () => {
    if (!confirm("quotedata/quotedata/ 内の全Excelファイルから取込みます。\n\nよろしいですか？")) return;

    setImporting(true);
    setImportResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/material-prices/import", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session?.access_token}`,
        },
      });
      const result = await res.json();
      setImportResult(result);
      if (res.ok) {
        fetchData();
      }
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

  const sortIcon = (key: keyof MaterialPrice) => {
    if (sortKey !== key) return "";
    return sortAsc ? " ▲" : " ▼";
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const fromIdx = page * PAGE_SIZE + 1;
  const toIdx = Math.min((page + 1) * PAGE_SIZE, totalCount);

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">材料単価</h1>

      {/* インポートセクション */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <button
            onClick={handleImport}
            disabled={importing}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {importing ? "取込中..." : "Excelデータ取込"}
          </button>
          <span className="text-sm text-gray-600">
            Excelの内訳シートから材料費・労務費を自動分類して全件取込
          </span>
        </div>

        {importResult && (
          <div className={`mt-3 p-3 rounded text-sm ${importResult.error ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
            {importResult.error ? (
              <p>{String(importResult.error)}</p>
            ) : (
              <div>
                <p className="font-bold">{String(importResult.message)}</p>
                <p>処理ファイル数: {String(importResult.totalFiles)} / 取込件数: {String(importResult.insertedCount)}</p>
                {Array.isArray(importResult.fileErrors) && importResult.fileErrors.length > 0 && (
                  <div className="mt-1 text-red-600">
                    <p>ファイルエラー:</p>
                    {(importResult.fileErrors as string[]).map((e: string, i: number) => <p key={i}>・{e}</p>)}
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
        <button
          onClick={findDuplicates}
          className="bg-yellow-500 text-white px-3 py-1 rounded text-sm hover:bg-yellow-600"
        >
          重複チェック
        </button>
        <button
          onClick={handleDeleteAll}
          className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600"
        >
          {activeTab}全件削除
        </button>
      </div>

      {/* 重複管理パネル */}
      {showDuplicates && (
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
              <th className="border p-2 text-center whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="border p-4 text-center text-gray-400">読込中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="border p-4 text-center text-gray-400">データがありません</td></tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="border p-2">{item.name}</td>
                  <td className="border p-2">{item.specification}</td>
                  <td className="border p-2">{item.unit}</td>
                  <td className="border p-2 text-right">¥{Number(item.unit_price).toLocaleString("ja-JP")}</td>
                  <td className="border p-2 text-xs text-gray-500">{item.source_file}</td>
                  <td className="border p-2 text-center">
                    <button
                      onClick={() => handleDelete(item.id, item.name)}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >
                      削除
                    </button>
                  </td>
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

export default withAdminRoute(MaterialPricesPage);

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

  // タブ・検索変更時にページリセット
  useEffect(() => {
    setPage(0);
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
    if (!confirm("quotedata/quotedata/ 内の全Excelファイルから取込みます。\n同じ項目は単価が高い方を採用します。\n\nよろしいですか？")) return;

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
    }
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
            Excelの内訳シートから材料費・労務費を自動分類して取込
          </span>
        </div>

        {importResult && (
          <div className={`mt-3 p-3 rounded text-sm ${importResult.error ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
            {importResult.error ? (
              <p>{String(importResult.error)}</p>
            ) : (
              <div>
                <p className="font-bold">{String(importResult.message)}</p>
                <p>処理ファイル数: {String(importResult.totalFiles)} / 全レコード数: {String(importResult.totalRecords)} / 重複排除後: {String(importResult.dedupedCount)}</p>
                {Array.isArray(importResult.fileErrors) && (
                  <div className="mt-1 text-red-600">
                    <p>ファイルエラー:</p>
                    {(importResult.fileErrors as string[]).map((e: string, i: number) => <p key={i}>・{e}</p>)}
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

      {/* 検索バー + 全件削除 */}
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
          onClick={handleDeleteAll}
          className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600"
        >
          {activeTab}全件削除
        </button>
      </div>

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

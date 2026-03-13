"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { isFuzzyMatch as isSimilarSite } from "@/lib/fuzzyMatch";

interface OpModal {
  itemId: string;
  quantity: number;
  siteName: string;
  siteConfirmPending: boolean;
}

export default function InventoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [searchCategory, setSearchCategory] = useState("");
  const [searchManufacturer, setSearchManufacturer] = useState("");
  const [searchDetail, setSearchDetail] = useState("");
  const [pastSiteNames, setPastSiteNames] = useState<string[]>([]);
  const [opModal, setOpModal] = useState<OpModal | null>(null);
  const [sortKey, setSortKey] = useState<"type" | "maker" | "detail" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const fetchItems = async () => {
    let query = supabase.from("inventory").select("*").order("created_at", { ascending: true });
    if (searchCategory) query = query.ilike("type", `%${searchCategory}%`);
    if (searchManufacturer) query = query.ilike("maker", `%${searchManufacturer}%`);
    if (searchDetail) query = query.ilike("detail", `%${searchDetail}%`);
    const { data, error } = await query;
    if (error) console.error("Error fetching items:", error);
    else setItems(data || []);
  };

  const fetchPastSiteNames = async () => {
    const { data } = await supabase
      .from("inventory_logs")
      .select("site_name")
      .not("site_name", "is", null);
    if (data) {
      const unique = [...new Set(data.map((d: any) => d.site_name).filter(Boolean))] as string[];
      setPastSiteNames(unique);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [searchCategory, searchManufacturer, searchDetail]);

  useEffect(() => {
    fetchPastSiteNames();
  }, []);

  const updateQuantity = async (change: number) => {
    if (!opModal) return;
    const { itemId, quantity, siteName } = opModal;
    if (quantity <= 0 || !siteName.trim()) return;

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      alert("ログインしてください");
      return;
    }

    const currentItem = items.find((item: any) => item.id === itemId);
    if (!currentItem) return;
    const newQuantity = currentItem.quantity + change * quantity;

    const { error } = await supabase
      .from("inventory")
      .update({ quantity: newQuantity })
      .eq("id", itemId);

    if (error) {
      console.error(error);
      return;
    }

    const { error: logError } = await supabase.from("inventory_logs").insert({
      item_id: itemId,
      change_type: change > 0 ? "in" : "out",
      quantity,
      user_id: userData.user.id,
      site_name: siteName || null,
    });
    if (logError) {
      console.error("ログ保存エラー:", logError.message, logError.code);
      alert("在庫は更新しましたが、ログの保存に失敗しました: " + logError.message);
    }

    setOpModal(null);
    fetchItems();
    fetchPastSiteNames();
  };

  const toggleSort = (key: "type" | "maker" | "detail") => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };
  const sortIcon = (key: "type" | "maker" | "detail") =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : " ⇅";
  const sortedItems = sortKey
    ? [...items].sort((a, b) => {
        const av = (a[sortKey] || "").toLowerCase();
        const bv = (b[sortKey] || "").toLowerCase();
        return sortDir === "asc" ? av.localeCompare(bv, "ja") : bv.localeCompare(av, "ja");
      })
    : items;

  const suggestedSites = opModal?.siteName.trim()
    ? pastSiteNames.filter((s) => isSimilarSite(s, opModal.siteName))
    : [];

  const opItem = opModal ? items.find((i) => i.id === opModal.itemId) : null;
  const canSubmit = opModal ? opModal.quantity > 0 && !!opModal.siteName.trim() : false;

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">在庫一覧</h1>

      {/* 操作モーダル */}
      {opModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">

            {/* 商品情報 */}
            <div className="mb-4">
              <h2 className="text-base font-bold mb-1">入庫 / 出庫</h2>
              <div className="text-sm text-gray-700 bg-gray-50 rounded p-2">
                {opItem?.type}　{opItem?.maker}　{opItem?.detail}
                <span className="ml-2 text-gray-400 text-xs">（現在: {opItem?.quantity} {opItem?.unit}）</span>
              </div>
            </div>

            {/* 数量入力 */}
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">数量</label>
              <div className="flex items-center gap-1">
                <button onClick={() => setOpModal((p) => p && { ...p, quantity: Math.max(0, p.quantity - 100) })}
                  className="bg-gray-200 hover:bg-gray-300 text-xs px-2 py-1.5 rounded">-100</button>
                <button onClick={() => setOpModal((p) => p && { ...p, quantity: Math.max(0, p.quantity - 10) })}
                  className="bg-gray-200 hover:bg-gray-300 text-xs px-2 py-1.5 rounded">-10</button>
                <input
                  type="number"
                  min="0"
                  value={opModal.quantity || ""}
                  onChange={(e) => setOpModal((p) => p && { ...p, quantity: Math.max(0, Number(e.target.value)) })}
                  className="border rounded p-1 w-20 text-center text-sm flex-1"
                />
                <button onClick={() => setOpModal((p) => p && { ...p, quantity: p.quantity + 10 })}
                  className="bg-gray-200 hover:bg-gray-300 text-xs px-2 py-1.5 rounded">+10</button>
                <button onClick={() => setOpModal((p) => p && { ...p, quantity: p.quantity + 100 })}
                  className="bg-gray-200 hover:bg-gray-300 text-xs px-2 py-1.5 rounded">+100</button>
              </div>
            </div>

            {/* 現場名入力 */}
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">現場名（必須）</label>
              <input
                type="text"
                placeholder="現場名を入力"
                value={opModal.siteName}
                autoComplete="off"
                onChange={(e) => setOpModal((p) => p && { ...p, siteName: e.target.value, siteConfirmPending: false })}
                className="border rounded p-2 w-full text-sm"
              />

              {/* インラインサジェスト */}
              {suggestedSites.length > 0 && (
                <div className="mt-1">
                  <p className="text-xs text-gray-400 mb-1">これですか？</p>
                  <ul className="space-y-1 max-h-32 overflow-y-auto">
                    {suggestedSites.map((s) => (
                      <li key={s}>
                        <button
                          onClick={() => setOpModal((p) => p && { ...p, siteName: s, siteConfirmPending: false })}
                          className="w-full text-left border rounded px-3 py-1.5 text-sm hover:bg-blue-50 hover:border-blue-300"
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* 入庫・出庫・キャンセル */}
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => updateQuantity(1)}
                disabled={!canSubmit}
                className="flex-1 bg-green-500 hover:bg-green-600 text-white py-2 rounded font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                入庫
              </button>
              <button
                onClick={() => updateQuantity(-1)}
                disabled={!canSubmit}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                出庫
              </button>
            </div>
            <button
              onClick={() => setOpModal(null)}
              className="w-full bg-gray-300 hover:bg-gray-400 text-gray-700 py-2 rounded text-sm"
            >
              キャンセル
            </button>

          </div>
        </div>
      )}

      {/* 検索 */}
      <div className="mb-4 flex gap-2 flex-wrap">
        <input type="text" placeholder="種類で検索" value={searchCategory}
          onChange={(e) => setSearchCategory(e.target.value)}
          className="border rounded p-2 text-sm" />
        <input type="text" placeholder="メーカーで検索" value={searchManufacturer}
          onChange={(e) => setSearchManufacturer(e.target.value)}
          className="border rounded p-2 text-sm" />
        <input type="text" placeholder="詳細で検索" value={searchDetail}
          onChange={(e) => setSearchDetail(e.target.value)}
          className="border rounded p-2 text-sm" />
      </div>

      {/* テーブル */}
      <div className="overflow-x-auto">
      <table className="table-auto border-collapse border text-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="border px-3 py-2 text-left whitespace-nowrap w-1 cursor-pointer select-none hover:bg-gray-200" onClick={() => toggleSort("type")}>種類{sortIcon("type")}</th>
            <th className="border px-3 py-2 text-left whitespace-nowrap w-1 cursor-pointer select-none hover:bg-gray-200" onClick={() => toggleSort("maker")}>メーカー{sortIcon("maker")}</th>
            <th className="border px-3 py-2 text-left whitespace-nowrap w-1 cursor-pointer select-none hover:bg-gray-200" onClick={() => toggleSort("detail")}>詳細{sortIcon("detail")}</th>
            <th className="border px-3 py-2 text-center whitespace-nowrap w-1">単位</th>
            <th className="border px-3 py-2 text-center whitespace-nowrap w-1">在庫数</th>
            <th className="border px-3 py-2 text-center w-1">操作</th>
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item) => (
            <tr key={item.id} className="hover:bg-gray-50">
              <td className="border px-3 py-2 whitespace-nowrap">{item.type}</td>
              <td className="border px-3 py-2 whitespace-nowrap">{item.maker}</td>
              <td className="border px-3 py-2 whitespace-nowrap">{item.detail}</td>
              <td className="border px-3 py-2 text-center whitespace-nowrap">{item.unit}</td>
              <td className="border px-3 py-2 text-center font-bold whitespace-nowrap">{item.quantity}</td>
              <td className="border px-3 py-2 text-center w-1">
                <button
                  onClick={() => setOpModal({ itemId: item.id, quantity: 0, siteName: "", siteConfirmPending: false })}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-bold whitespace-nowrap"
                >
                  入出庫
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

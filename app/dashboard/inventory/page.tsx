"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { isFuzzyMatch as isSimilarSite } from "@/lib/fuzzyMatch";

export default function InventoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [searchCategory, setSearchCategory] = useState("");
  const [searchManufacturer, setSearchManufacturer] = useState("");
  const [searchDetail, setSearchDetail] = useState("");
  const [quantities, setQuantities] = useState<{ [key: string]: number }>({});
  const [siteNames, setSiteNames] = useState<{ [key: string]: string }>({});
  const [pastSiteNames, setPastSiteNames] = useState<string[]>([]);
  const [siteModal, setSiteModal] = useState<{ itemId: string; query: string } | null>(null);
  const [siteConfirm, setSiteConfirm] = useState<{ itemId: string; query: string } | null>(null);
  const [siteAction, setSiteAction] = useState<{ itemId: string; siteName: string } | null>(null);
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

  const adjustQuantity = (id: string, delta: number) => {
    setQuantities((prev) => ({
      ...prev,
      [id]: Math.max(0, (prev[id] || 0) + delta),
    }));
  };

  const updateQuantity = async (id: string, change: number, siteName: string) => {
    const value = quantities[id];
    if (!value || value <= 0) return;

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      alert("ログインしてください");
      return;
    }

    const currentItem = items.find((item: any) => item.id === id);
    if (!currentItem) return;
    const newQuantity = currentItem.quantity + change * value;

    const { error } = await supabase
      .from("inventory")
      .update({ quantity: newQuantity })
      .eq("id", id);

    if (error) {
      console.error(error);
      return;
    }

    const { error: logError } = await supabase.from("inventory_logs").insert({
      item_id: id,
      change_type: change > 0 ? "in" : "out",
      quantity: value,
      user_id: userData.user.id,
      site_name: siteName || null,
    });
    if (logError) {
      console.error("ログ保存エラー:", logError.message, logError.code);
      alert("在庫は更新しましたが、ログの保存に失敗しました: " + logError.message);
    }

    setQuantities((prev) => ({ ...prev, [id]: 0 }));
    setSiteNames((prev) => ({ ...prev, [id]: "" }));
    setSiteAction(null);
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

  const openSiteAction = (itemId: string, name: string) => {
    setSiteNames((prev) => ({ ...prev, [itemId]: name }));
    setSiteAction({ itemId, siteName: name });
    setSiteModal(null);
    setSiteConfirm(null);
  };

  const filteredSites = siteModal
    ? pastSiteNames.filter((s) => isSimilarSite(s, siteModal.query))
    : [];

  const actionItem = siteAction ? items.find((i) => i.id === siteAction.itemId) : null;
  const actionQty = siteAction ? (quantities[siteAction.itemId] || 0) : 0;

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">在庫一覧</h1>

      {/* 現場名サジェストモーダル */}
      {siteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h2 className="text-base font-bold mb-1">現場名の確認</h2>
            <p className="text-xs text-gray-500 mb-2">編集すると随時再検索されます</p>
            <input
              type="text"
              value={siteModal.query}
              autoFocus
              onChange={(e) => {
                const val = e.target.value;
                setSiteModal({ ...siteModal, query: val });
                setSiteNames((prev) => ({ ...prev, [siteModal.itemId]: val }));
              }}
              className="border rounded p-2 w-full text-sm mb-3"
            />
            {filteredSites.length > 0 ? (
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">これですか？</p>
                <ul className="space-y-1 max-h-40 overflow-y-auto">
                  {filteredSites.map((s) => (
                    <li key={s}>
                      <button
                        onClick={() => openSiteAction(siteModal.itemId, s)}
                        className="w-full text-left border rounded px-3 py-2 text-sm hover:bg-blue-50 hover:border-blue-300"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-gray-400 mb-3">類似する現場名はありません</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSiteConfirm({ itemId: siteModal.itemId, query: siteModal.query });
                  setSiteModal(null);
                }}
                className="flex-1 bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded text-sm font-bold"
              >
                新規登録
              </button>
              <button
                onClick={() => {
                  setSiteNames((prev) => ({ ...prev, [siteModal.itemId]: "" }));
                  setSiteModal(null);
                }}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 px-3 py-2 rounded text-sm"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新規現場名確認モーダル */}
      {siteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h2 className="text-base font-bold mb-3">新規現場名の確認</h2>
            <p className="text-sm text-gray-600 mb-4">
              「<span className="font-semibold text-blue-700">{siteConfirm.query}</span>」を新しい現場名として登録しますか？
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => openSiteAction(siteConfirm.itemId, siteConfirm.query)}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded text-sm font-bold"
              >
                OK
              </button>
              <button
                onClick={() => {
                  setSiteModal({ itemId: siteConfirm.itemId, query: siteConfirm.query });
                  setSiteConfirm(null);
                }}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 px-3 py-2 rounded text-sm"
              >
                NO
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 入庫・出庫アクションモーダル */}
      {siteAction && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h2 className="text-base font-bold mb-3">入庫 / 出庫の確認</h2>
            <div className="bg-gray-50 rounded p-3 mb-4 text-sm space-y-1">
              <div><span className="text-gray-500 text-xs">商品</span><br />{actionItem?.type}　{actionItem?.maker}　{actionItem?.detail}</div>
              <div><span className="text-gray-500 text-xs">現場</span><br /><span className="font-semibold text-blue-700">{siteAction.siteName}</span></div>
              <div><span className="text-gray-500 text-xs">数量</span><br /><span className="font-bold text-lg">{actionQty}</span> {actionItem?.unit}</div>
            </div>
            {actionQty <= 0 && (
              <p className="text-xs text-red-500 mb-3">数量を1以上入力してください</p>
            )}
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => updateQuantity(siteAction.itemId, 1, siteAction.siteName)}
                disabled={actionQty <= 0}
                className="flex-1 bg-green-500 hover:bg-green-600 text-white py-2 rounded font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                入庫
              </button>
              <button
                onClick={() => updateQuantity(siteAction.itemId, -1, siteAction.siteName)}
                disabled={actionQty <= 0}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                出庫
              </button>
            </div>
            <button
              onClick={() => {
                setSiteNames((prev) => ({ ...prev, [siteAction.itemId]: "" }));
                setSiteAction(null);
              }}
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
              <td className="border px-3 py-3 w-1">
                <div className="flex flex-col gap-2">

                  {/* 数量入力行 */}
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500 w-8">数量</span>
                    <button onClick={() => adjustQuantity(item.id, -100)}
                      className="bg-gray-200 hover:bg-gray-300 text-xs px-1.5 py-1 rounded">-100</button>
                    <button onClick={() => adjustQuantity(item.id, -10)}
                      className="bg-gray-200 hover:bg-gray-300 text-xs px-1.5 py-1 rounded">-10</button>
                    <input
                      type="number"
                      min="0"
                      value={quantities[item.id] || ""}
                      onChange={(e) =>
                        setQuantities({ ...quantities, [item.id]: Math.max(0, Number(e.target.value)) })
                      }
                      className="border rounded p-1 w-16 text-center text-sm"
                    />
                    <button onClick={() => adjustQuantity(item.id, 10)}
                      className="bg-gray-200 hover:bg-gray-300 text-xs px-1.5 py-1 rounded">+10</button>
                    <button onClick={() => adjustQuantity(item.id, 100)}
                      className="bg-gray-200 hover:bg-gray-300 text-xs px-1.5 py-1 rounded">+100</button>
                  </div>

                  {/* 現場名入力行 */}
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500 w-8">現場</span>
                    <input
                      type="text"
                      placeholder="現場名を入力して確定"
                      value={siteNames[item.id] || ""}
                      onChange={(e) =>
                        setSiteNames((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      onBlur={() => {
                        const val = siteNames[item.id] || "";
                        if (val.trim()) setSiteModal({ itemId: item.id, query: val });
                      }}
                      className="border rounded p-1 text-sm flex-1"
                    />
                  </div>

                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

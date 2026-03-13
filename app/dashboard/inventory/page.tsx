"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function InventoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [searchCategory, setSearchCategory] = useState("");
  const [searchManufacturer, setSearchManufacturer] = useState("");
  const [searchDetail, setSearchDetail] = useState("");
  const [quantities, setQuantities] = useState<{ [key: string]: number }>({});
  const [siteNames, setSiteNames] = useState<{ [key: string]: string }>({});

  const fetchItems = async () => {
    let query = supabase.from("inventory").select("*").order("created_at", { ascending: true });
    if (searchCategory) query = query.ilike("type", `%${searchCategory}%`);
    if (searchManufacturer) query = query.ilike("maker", `%${searchManufacturer}%`);
    if (searchDetail) query = query.ilike("detail", `%${searchDetail}%`);
    const { data, error } = await query;
    if (error) console.error("Error fetching items:", error);
    else setItems(data || []);
  };

  useEffect(() => {
    fetchItems();
  }, [searchCategory, searchManufacturer, searchDetail]);

  const adjustQuantity = (id: string, delta: number) => {
    setQuantities((prev) => ({
      ...prev,
      [id]: Math.max(0, (prev[id] || 0) + delta),
    }));
  };

  const updateQuantity = async (id: string, change: number) => {
    const value = quantities[id];
    if (!value || value <= 0) return;
    if (!siteNames[id]?.trim()) return;

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
      site_name: siteNames[id] || null,
    });
    if (logError) {
      console.error("ログ保存エラー:", logError.message, logError.code);
      alert("在庫は更新しましたが、ログの保存に失敗しました: " + logError.message);
    }

    setQuantities((prev) => ({ ...prev, [id]: 0 }));
    setSiteNames((prev) => ({ ...prev, [id]: "" }));
    fetchItems();
  };

  const canSubmit = (id: string) =>
    (quantities[id] || 0) > 0 && !!siteNames[id]?.trim();

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">在庫一覧</h1>

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
            <th className="border px-3 py-2 text-left whitespace-nowrap w-1">種類</th>
            <th className="border px-3 py-2 text-left whitespace-nowrap w-1">メーカー</th>
            <th className="border px-3 py-2 text-left whitespace-nowrap w-1">詳細</th>
            <th className="border px-3 py-2 text-center whitespace-nowrap w-1">単位</th>
            <th className="border px-3 py-2 text-center whitespace-nowrap w-1">在庫数</th>
            <th className="border px-3 py-2 text-center w-1">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
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
                      placeholder="現場名（必須）"
                      value={siteNames[item.id] || ""}
                      onChange={(e) =>
                        setSiteNames({ ...siteNames, [item.id]: e.target.value })
                      }
                      className="border rounded p-1 text-sm flex-1"
                    />
                  </div>

                  {/* 入庫・出庫ボタン行 */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateQuantity(item.id, 1)}
                      disabled={!canSubmit(item.id)}
                      className="flex-1 bg-green-500 hover:bg-green-600 text-white py-1.5 rounded font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      入庫
                    </button>
                    <button
                      onClick={() => updateQuantity(item.id, -1)}
                      disabled={!canSubmit(item.id)}
                      className="flex-1 bg-red-500 hover:bg-red-600 text-white py-1.5 rounded font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      出庫
                    </button>
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

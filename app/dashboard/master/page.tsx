"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import withAdminRoute from "@/components/withAdminRoute";
import { isFuzzyMatch as isSimilar } from "@/lib/fuzzyMatch";

interface Item {
  id: string;
  type: string;
  maker: string;
  detail: string;
  unit: string;
  quantity: number;
}

function MasterPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [form, setForm] = useState({ type: "", maker: "", detail: "", unit: "", quantity: 0 });
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Omit<Item, "id">>({ type: "", maker: "", detail: "", unit: "", quantity: 0 });

  // 類似品確認モーダル用
  const [similarItems, setSimilarItems] = useState<Item[]>([]);
  const [pendingForm, setPendingForm] = useState<typeof form | null>(null);

  // 種類サジェストモーダル
  const [typeModal, setTypeModal] = useState<{ query: string } | null>(null);
  const [typeConfirm, setTypeConfirm] = useState<{ query: string } | null>(null);

  // 詳細サジェストモーダル
  const [detailModal, setDetailModal] = useState<{ query: string } | null>(null);
  const [detailConfirm, setDetailConfirm] = useState<{ query: string } | null>(null);

  const fetchItems = async () => {
    const { data, error } = await supabase.from("inventory").select("*").order("created_at", { ascending: false });
    if (!error && data) setItems(data as Item[]);
  };

  useEffect(() => {
    fetchItems();
  }, []);

  // 登録ボタン押下
  const addItem = async () => {
    if (!form.detail || !form.unit) {
      alert("詳細と単位は必須です");
      return;
    }

    // 完全一致チェック
    const exact = items.find(
      (item) =>
        item.type.trim().toLowerCase() === form.type.trim().toLowerCase() &&
        item.maker.trim().toLowerCase() === form.maker.trim().toLowerCase() &&
        item.detail.trim().toLowerCase() === form.detail.trim().toLowerCase() &&
        item.unit.trim().toLowerCase() === form.unit.trim().toLowerCase()
    );
    if (exact) {
      await mergeItem(exact, form.quantity);
      return;
    }

    // 類似品チェック
    const similar = items.filter(
      (item) =>
        isSimilar(item.detail, form.detail) ||
        (isSimilar(item.type, form.type) && isSimilar(item.maker, form.maker))
    );

    if (similar.length > 0) {
      setPendingForm(form);
      setSimilarItems(similar);
    } else {
      await insertItem(form);
    }
  };

  // 数量加算
  const mergeItem = async (target: Item, qty: number) => {
    setLoading(true);
    const { error } = await supabase
      .from("inventory")
      .update({ quantity: target.quantity + qty })
      .eq("id", target.id);
    setLoading(false);
    if (error) {
      console.error(error);
      alert("数量の更新に失敗しました");
    } else {
      alert(`「${target.detail}」に ${qty} を加算しました`);
      setForm({ type: "", maker: "", detail: "", unit: "", quantity: 0 });
      setSimilarItems([]);
      setPendingForm(null);
      fetchItems();
    }
  };

  // 新規登録
  const insertItem = async (data: typeof form) => {
    setLoading(true);
    const { error } = await supabase.from("inventory").insert([data]);
    setLoading(false);
    if (error) {
      console.error(error);
      alert("登録に失敗しました");
    } else {
      setForm({ type: "", maker: "", detail: "", unit: "", quantity: 0 });
      setSimilarItems([]);
      setPendingForm(null);
      fetchItems();
    }
  };

  // 編集開始
  const startEdit = (item: Item) => {
    setEditingId(item.id);
    setEditForm({ type: item.type, maker: item.maker, detail: item.detail, unit: item.unit, quantity: item.quantity });
  };

  // 編集保存
  const saveEdit = async (id: string) => {
    if (!editForm.detail || !editForm.unit) {
      alert("詳細と単位は必須です");
      return;
    }
    const { error } = await supabase.from("inventory").update(editForm).eq("id", id);
    if (error) {
      console.error(error);
      alert("更新に失敗しました");
    } else {
      setEditingId(null);
      fetchItems();
    }
  };

  // 削除
  const deleteItem = async (id: string) => {
    if (!confirm("本当に削除しますか？")) return;
    const { error } = await supabase.from("inventory").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert("削除に失敗しました");
    } else {
      fetchItems();
    }
  };

  // ソート
  const [sortKey, setSortKey] = useState<"type" | "maker" | "detail" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

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

  // 種類サジェスト候補（ユニーク）
  const typeMatches = typeModal
    ? [...new Set(items.map((i) => i.type).filter(Boolean))].filter((t) => isSimilar(t, typeModal.query))
    : [];

  // 詳細サジェスト候補（アイテム全体）
  const detailMatches = detailModal
    ? items.filter((i) => isSimilar(i.detail, detailModal.query))
    : [];

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">商品マスタ編集（管理者専用）</h1>

      {/* 種類サジェストモーダル */}
      {typeModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h2 className="text-base font-bold mb-1">種類の確認</h2>
            <p className="text-xs text-gray-500 mb-2">編集すると随時再検索されます</p>
            <input
              type="text"
              value={typeModal.query}
              autoFocus
              onChange={(e) => {
                setTypeModal({ query: e.target.value });
                setForm((prev) => ({ ...prev, type: e.target.value }));
              }}
              className="border rounded p-2 w-full text-sm mb-3"
            />
            {typeMatches.length > 0 ? (
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">これですか？</p>
                <ul className="space-y-1 max-h-40 overflow-y-auto">
                  {typeMatches.map((t) => (
                    <li key={t}>
                      <button
                        onClick={() => {
                          setForm((prev) => ({ ...prev, type: t }));
                          setTypeModal(null);
                        }}
                        className="w-full text-left border rounded px-3 py-2 text-sm hover:bg-blue-50 hover:border-blue-300"
                      >
                        {t}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-gray-400 mb-3">類似する種類はありません</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setTypeConfirm({ query: typeModal.query });
                  setTypeModal(null);
                }}
                className="flex-1 bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded text-sm font-bold"
              >
                新規登録
              </button>
              <button
                onClick={() => {
                  setForm((prev) => ({ ...prev, type: "" }));
                  setTypeModal(null);
                }}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 px-3 py-2 rounded text-sm"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 種類新規確認モーダル */}
      {typeConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h2 className="text-base font-bold mb-3">新規種類の確認</h2>
            <p className="text-sm text-gray-600 mb-4">
              「<span className="font-semibold text-blue-700">{typeConfirm.query}</span>」を新しい種類として登録しますか？
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setForm((prev) => ({ ...prev, type: typeConfirm.query }));
                  setTypeConfirm(null);
                }}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded text-sm font-bold"
              >
                OK
              </button>
              <button
                onClick={() => {
                  setTypeModal({ query: typeConfirm.query });
                  setTypeConfirm(null);
                }}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 px-3 py-2 rounded text-sm"
              >
                NO
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 詳細サジェストモーダル */}
      {detailModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h2 className="text-base font-bold mb-1">詳細の確認</h2>
            <p className="text-xs text-gray-500 mb-2">選択すると種類・メーカー・単位も自動入力されます</p>
            <input
              type="text"
              value={detailModal.query}
              autoFocus
              onChange={(e) => {
                setDetailModal({ query: e.target.value });
                setForm((prev) => ({ ...prev, detail: e.target.value }));
              }}
              className="border rounded p-2 w-full text-sm mb-3"
            />
            {detailMatches.length > 0 ? (
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">これですか？</p>
                <ul className="space-y-1 max-h-48 overflow-y-auto">
                  {detailMatches.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => {
                          setForm((prev) => ({
                            ...prev,
                            type: item.type,
                            maker: item.maker,
                            detail: item.detail,
                            unit: item.unit,
                          }));
                          setDetailModal(null);
                        }}
                        className="w-full text-left border rounded px-3 py-2 text-sm hover:bg-blue-50 hover:border-blue-300"
                      >
                        <span className="font-medium">{item.detail}</span>
                        <span className="text-xs text-gray-400 ml-2">（{item.type} / {item.maker}）</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-gray-400 mb-3">類似する詳細はありません</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setDetailConfirm({ query: detailModal.query });
                  setDetailModal(null);
                }}
                className="flex-1 bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded text-sm font-bold"
              >
                新規登録
              </button>
              <button
                onClick={() => {
                  setForm((prev) => ({ ...prev, detail: "" }));
                  setDetailModal(null);
                }}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 px-3 py-2 rounded text-sm"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 詳細新規確認モーダル */}
      {detailConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h2 className="text-base font-bold mb-3">新規詳細の確認</h2>
            <p className="text-sm text-gray-600 mb-4">
              「<span className="font-semibold text-blue-700">{detailConfirm.query}</span>」を新しい詳細として登録しますか？
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setForm((prev) => ({ ...prev, detail: detailConfirm.query }));
                  setDetailConfirm(null);
                }}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded text-sm font-bold"
              >
                OK
              </button>
              <button
                onClick={() => {
                  setDetailModal({ query: detailConfirm.query });
                  setDetailConfirm(null);
                }}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 px-3 py-2 rounded text-sm"
              >
                NO
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新規登録フォーム */}
      <div className="bg-gray-50 border rounded p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-600 mb-2">新規登録</h2>
        <div className="grid grid-cols-5 gap-2 mb-2">
          <input
            type="text"
            placeholder="種類"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            onBlur={() => { if (form.type.trim()) setTypeModal({ query: form.type }); }}
            className="border rounded p-2 text-sm"
          />
          <input type="text" placeholder="メーカー" value={form.maker}
            onChange={(e) => setForm({ ...form, maker: e.target.value })}
            className="border rounded p-2 text-sm" />
          <input
            type="text"
            placeholder="詳細（必須）"
            value={form.detail}
            onChange={(e) => setForm({ ...form, detail: e.target.value })}
            onBlur={() => { if (form.detail.trim()) setDetailModal({ query: form.detail }); }}
            className="border rounded p-2 text-sm"
          />
          <input type="text" placeholder="単位（必須）" value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
            className="border rounded p-2 text-sm" />
          <input type="number" placeholder="数量" value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 0 })}
            className="border rounded p-2 text-sm" />
        </div>
        <button onClick={addItem} disabled={loading}
          className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
          {loading ? "処理中..." : "登録"}
        </button>
      </div>

      {/* 類似品確認モーダル */}
      {similarItems.length > 0 && pendingForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl">
            <h2 className="text-lg font-bold mb-1">類似する商品が見つかりました</h2>
            <p className="text-sm text-gray-500 mb-4">
              登録しようとした商品と似ているものがあります。既存の商品に数量を加算しますか？それとも新規登録しますか？
            </p>

            <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 text-sm">
              <span className="font-semibold text-blue-700">登録内容：</span>
              　{pendingForm.type}　{pendingForm.maker}　{pendingForm.detail}　{pendingForm.unit}　{pendingForm.quantity}
            </div>

            <table className="w-full border text-sm mb-4">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border px-3 py-1 text-left">種類</th>
                  <th className="border px-3 py-1 text-left">メーカー</th>
                  <th className="border px-3 py-1 text-left">詳細</th>
                  <th className="border px-3 py-1 text-center">単位</th>
                  <th className="border px-3 py-1 text-center">現在数量</th>
                  <th className="border px-3 py-1 text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {similarItems.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="border px-3 py-1">{item.type}</td>
                    <td className="border px-3 py-1">{item.maker}</td>
                    <td className="border px-3 py-1">{item.detail}</td>
                    <td className="border px-3 py-1 text-center">{item.unit}</td>
                    <td className="border px-3 py-1 text-center font-bold">{item.quantity}</td>
                    <td className="border px-3 py-1 text-center">
                      <button
                        onClick={() => mergeItem(item, pendingForm.quantity)}
                        className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-xs"
                      >
                        これに +{pendingForm.quantity} 加算
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setSimilarItems([]); setPendingForm(null); }}
                className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded text-sm"
              >
                キャンセル
              </button>
              <button
                onClick={() => insertItem(pendingForm)}
                className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded text-sm"
              >
                別商品として新規登録
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 商品一覧 */}
      <div className="overflow-x-auto">
      <table className="table-auto border-collapse border text-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="border px-3 py-2 text-left whitespace-nowrap w-1 cursor-pointer select-none hover:bg-gray-200" onClick={() => toggleSort("type")}>種類{sortIcon("type")}</th>
            <th className="border px-3 py-2 text-left whitespace-nowrap w-1 cursor-pointer select-none hover:bg-gray-200" onClick={() => toggleSort("maker")}>メーカー{sortIcon("maker")}</th>
            <th className="border px-3 py-2 text-left whitespace-nowrap w-1 cursor-pointer select-none hover:bg-gray-200" onClick={() => toggleSort("detail")}>詳細{sortIcon("detail")}</th>
            <th className="border px-3 py-2 text-center whitespace-nowrap w-1">単位</th>
            <th className="border px-3 py-2 text-center whitespace-nowrap w-1">数量</th>
            <th className="border px-3 py-2 text-center w-36">操作</th>
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item) =>
            editingId === item.id ? (
              <tr key={item.id} className="bg-yellow-50">
                <td className="border px-2 py-1 whitespace-nowrap w-1">
                  <input value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                    className="border rounded p-1 w-full text-sm" />
                </td>
                <td className="border px-2 py-1 whitespace-nowrap w-1">
                  <input value={editForm.maker} onChange={(e) => setEditForm({ ...editForm, maker: e.target.value })}
                    className="border rounded p-1 w-full text-sm" />
                </td>
                <td className="border px-2 py-1 whitespace-nowrap w-1">
                  <input value={editForm.detail} onChange={(e) => setEditForm({ ...editForm, detail: e.target.value })}
                    className="border rounded p-1 w-full text-sm" />
                </td>
                <td className="border px-2 py-1 whitespace-nowrap w-1">
                  <input value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                    className="border rounded p-1 w-full text-sm" />
                </td>
                <td className="border px-2 py-1 whitespace-nowrap w-1">
                  <input type="number" value={editForm.quantity}
                    onChange={(e) => setEditForm({ ...editForm, quantity: parseInt(e.target.value) || 0 })}
                    className="border rounded p-1 w-full text-sm text-center" />
                </td>
                <td className="border px-2 py-1 text-center space-x-1 w-36">
                  <button onClick={() => saveEdit(item.id)}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs">保存</button>
                  <button onClick={() => setEditingId(null)}
                    className="bg-gray-400 hover:bg-gray-500 text-white px-2 py-1 rounded text-xs">取消</button>
                </td>
              </tr>
            ) : (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="border px-3 py-2 whitespace-nowrap w-1">{item.type}</td>
                <td className="border px-3 py-2 whitespace-nowrap w-1">{item.maker}</td>
                <td className="border px-3 py-2 whitespace-nowrap w-1">{item.detail}</td>
                <td className="border px-3 py-2 text-center whitespace-nowrap w-1">{item.unit}</td>
                <td className="border px-3 py-2 text-center font-bold whitespace-nowrap w-1">{item.quantity}</td>
                <td className="border px-3 py-2 text-center space-x-1 w-36">
                  <button onClick={() => startEdit(item)}
                    className="bg-yellow-400 hover:bg-yellow-500 text-white px-2 py-1 rounded text-xs">編集</button>
                  <button onClick={() => deleteItem(item.id)}
                    className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs">削除</button>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export default withAdminRoute(MasterPage);

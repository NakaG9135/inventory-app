"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { isFuzzyMatch } from "@/lib/fuzzyMatch";

interface LendingItem {
  id: string;
  name: string;
}

interface LendingRecord {
  id: string;
  lending_item_id: string;
  site_name: string;
  manager_name: string;
  registrant_name: string;
  period_start: string;
  period_end: string;
  returned: boolean;
  returned_at: string | null;
  created_at: string;
  lending_items: { name: string } | null;
}

export default function LendingPage() {
  const [role, setRole] = useState<string>("user");
  const [currentUserName, setCurrentUserName] = useState("");
  const [lendingItems, setLendingItems] = useState<LendingItem[]>([]);
  const [records, setRecords] = useState<LendingRecord[]>([]);
  const [workers, setWorkers] = useState<string[]>([]);
  const [pastSiteNames, setPastSiteNames] = useState<string[]>([]);

  // Admin: 貸出物追加
  const [newItemName, setNewItemName] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemName, setEditingItemName] = useState("");

  // 貸出登録フォーム
  const [showForm, setShowForm] = useState(false);
  const [formItemId, setFormItemId] = useState("");
  const [formSiteName, setFormSiteName] = useState("");
  const [formManager, setFormManager] = useState("");
  const [formPeriodStart, setFormPeriodStart] = useState("");
  const [formPeriodEnd, setFormPeriodEnd] = useState("");

  // 検索
  const [searchItem, setSearchItem] = useState("");
  const [searchSite, setSearchSite] = useState("");
  const [searchManager, setSearchManager] = useState("");

  // 現場名サジェスト
  const [showSiteSuggest, setShowSiteSuggest] = useState(false);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from("users_profile").select("name, role").eq("id", user.id).single();
        if (data) {
          setCurrentUserName(data.name);
          setRole(data.role);
        }
      }
    };
    init();
    fetchLendingItems();
    fetchRecords();
    fetchWorkers();
    fetchSiteNames();
  }, []);

  const fetchLendingItems = async () => {
    const { data } = await supabase.from("lending_items").select("*").order("created_at");
    if (data) setLendingItems(data);
  };

  const fetchRecords = async () => {
    const { data } = await supabase
      .from("lending_records")
      .select("*, lending_items(name)")
      .order("created_at", { ascending: false });
    if (data) setRecords(data as LendingRecord[]);
  };

  const fetchWorkers = async () => {
    const { data } = await supabase.from("users_profile").select("name").order("name");
    if (data) setWorkers(data.map((d: any) => d.name));
  };

  const fetchSiteNames = async () => {
    const [logs, reports, reserves] = await Promise.all([
      supabase.from("inventory_logs").select("site_name").not("site_name", "is", null),
      supabase.from("daily_reports").select("site_name").not("site_name", "is", null),
      supabase.from("material_reserve_sites").select("site_name"),
    ]);
    const all = [
      ...(logs.data || []).map((d: any) => d.site_name),
      ...(reports.data || []).map((d: any) => d.site_name),
      ...(reserves.data || []).map((d: any) => d.site_name),
    ].filter(Boolean);
    setPastSiteNames([...new Set(all)] as string[]);
  };

  // Admin: 貸出物CRUD
  const handleAddItem = async () => {
    if (!newItemName.trim()) return;
    await supabase.from("lending_items").insert({ name: newItemName.trim() });
    setNewItemName("");
    fetchLendingItems();
  };

  const handleUpdateItem = async () => {
    if (!editingItemId || !editingItemName.trim()) return;
    await supabase.from("lending_items").update({ name: editingItemName.trim() }).eq("id", editingItemId);
    setEditingItemId(null);
    setEditingItemName("");
    fetchLendingItems();
    fetchRecords();
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm("この貸出物を削除しますか？関連する貸出記録も削除されます。")) return;
    await supabase.from("lending_items").delete().eq("id", id);
    fetchLendingItems();
    fetchRecords();
  };

  // 貸出登録
  const handleLend = async () => {
    if (!formItemId || !formSiteName.trim() || !formManager || !formPeriodStart || !formPeriodEnd) {
      alert("全ての項目を入力してください");
      return;
    }

    // 類似現場名チェック
    const similar = pastSiteNames.filter((s) => s !== formSiteName.trim() && isFuzzyMatch(s, formSiteName.trim()));
    if (similar.length > 0) {
      const msg = `類似の現場名があります:\n${similar.join("\n")}\n\nそのまま「${formSiteName.trim()}」で登録しますか？`;
      if (!confirm(msg)) return;
    }

    const { error } = await supabase.from("lending_records").insert({
      lending_item_id: formItemId,
      site_name: formSiteName.trim(),
      manager_name: formManager,
      registrant_name: currentUserName,
      period_start: formPeriodStart,
      period_end: formPeriodEnd,
    });
    if (error) { alert("登録に失敗しました: " + error.message); return; }

    setFormItemId("");
    setFormSiteName("");
    setFormManager("");
    setFormPeriodStart("");
    setFormPeriodEnd("");
    setShowForm(false);
    fetchRecords();
    fetchSiteNames();
  };

  // 返却
  const handleReturn = async (id: string) => {
    if (!confirm("この貸出物を返却しますか？")) return;
    await supabase.from("lending_records").update({
      returned: true,
      returned_at: new Date().toISOString(),
    }).eq("id", id);
    fetchRecords();
  };

  const formatDate = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  };

  const formatDateTime = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  // フィルタ
  const isAdmin = role === "admin";
  const visibleRecords = records.filter((r) => {
    if (!isAdmin && r.returned) return false;
    if (searchItem && !(r.lending_items?.name || "").toLowerCase().includes(searchItem.toLowerCase())) return false;
    if (searchSite && !r.site_name.toLowerCase().includes(searchSite.toLowerCase())) return false;
    if (searchManager && !r.manager_name.toLowerCase().includes(searchManager.toLowerCase())) return false;
    return true;
  });

  const suggestedSites = formSiteName.trim()
    ? pastSiteNames.filter((s) => s.toLowerCase().includes(formSiteName.trim().toLowerCase()))
    : [];

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-6">貸出管理</h1>

      {/* Admin: 貸出物管理 */}
      {isAdmin && (
        <section className="bg-white border rounded-lg p-4 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-3">貸出物の管理</h2>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
              placeholder="貸出物の名前を入力"
              className="border rounded p-2 flex-1 min-w-0 text-sm"
            />
            <button
              onClick={handleAddItem}
              disabled={!newItemName.trim()}
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm shrink-0 disabled:opacity-40"
            >
              追加
            </button>
          </div>
          {lendingItems.length > 0 && (
            <div className="space-y-1">
              {lendingItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2 py-1">
                  {editingItemId === item.id ? (
                    <>
                      <input
                        type="text"
                        value={editingItemName}
                        onChange={(e) => setEditingItemName(e.target.value)}
                        className="border rounded p-1 flex-1 min-w-0 text-sm"
                      />
                      <button onClick={handleUpdateItem} className="text-blue-500 text-xs">保存</button>
                      <button onClick={() => setEditingItemId(null)} className="text-gray-400 text-xs">取消</button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm">{item.name}</span>
                      <button
                        onClick={() => { setEditingItemId(item.id); setEditingItemName(item.name); }}
                        className="text-blue-500 text-xs"
                      >
                        編集
                      </button>
                      <button onClick={() => handleDeleteItem(item.id)} className="text-red-400 text-xs">削除</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 貸出登録ボタン */}
      <div className="mb-4">
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded text-sm font-bold"
        >
          {showForm ? "フォームを閉じる" : "＋ 新規貸出"}
        </button>
      </div>

      {/* 貸出登録フォーム */}
      {showForm && (
        <section className="bg-white border rounded-lg p-4 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-3">貸出登録</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">貸出物 *</label>
              <select
                value={formItemId}
                onChange={(e) => setFormItemId(e.target.value)}
                className="border rounded p-2 w-full text-sm"
              >
                <option value="">選択してください</option>
                {lendingItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>

            <div className="relative">
              <label className="text-xs text-gray-500 block mb-1">現場名 *</label>
              <input
                type="text"
                value={formSiteName}
                onChange={(e) => { setFormSiteName(e.target.value); setShowSiteSuggest(true); }}
                onFocus={() => setShowSiteSuggest(true)}
                onBlur={() => setTimeout(() => setShowSiteSuggest(false), 150)}
                placeholder="現場名を入力"
                autoComplete="off"
                className="border rounded p-2 w-full text-sm"
              />
              {showSiteSuggest && suggestedSites.length > 0 && (
                <ul className="absolute z-10 bg-white border rounded shadow-lg w-full max-h-32 overflow-y-auto mt-1">
                  {suggestedSites.map((s) => (
                    <li key={s}>
                      <button
                        onMouseDown={() => { setFormSiteName(s); setShowSiteSuggest(false); }}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">管理者 *</label>
              <select
                value={formManager}
                onChange={(e) => setFormManager(e.target.value)}
                className="border rounded p-2 w-full text-sm"
              >
                <option value="">選択してください</option>
                {workers.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">登録者</label>
              <input
                type="text"
                value={currentUserName}
                readOnly
                className="border rounded p-2 w-full text-sm bg-gray-50"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">使用期間（開始） *</label>
              <input
                type="date"
                value={formPeriodStart}
                onChange={(e) => setFormPeriodStart(e.target.value)}
                className="border rounded p-2 w-full text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">使用期間（終了） *</label>
              <input
                type="date"
                value={formPeriodEnd}
                onChange={(e) => setFormPeriodEnd(e.target.value)}
                className="border rounded p-2 w-full text-sm"
              />
            </div>
          </div>

          <button
            onClick={handleLend}
            className="bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded text-sm font-bold"
          >
            貸出登録
          </button>
        </section>
      )}

      {/* 検索 */}
      <div className="mb-4 flex gap-2 flex-wrap">
        <input type="text" placeholder="貸出物で検索" value={searchItem}
          onChange={(e) => setSearchItem(e.target.value)}
          className="border rounded p-2 text-sm" />
        <input type="text" placeholder="現場名で検索" value={searchSite}
          onChange={(e) => setSearchSite(e.target.value)}
          className="border rounded p-2 text-sm" />
        <input type="text" placeholder="管理者で検索" value={searchManager}
          onChange={(e) => setSearchManager(e.target.value)}
          className="border rounded p-2 text-sm" />
      </div>

      {/* 貸出一覧 */}
      <section className="bg-white border rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-500 mb-3">
          {isAdmin ? "貸出記録（全履歴）" : "貸出中一覧"}
        </h2>
        {visibleRecords.length === 0 ? (
          <p className="text-gray-400 text-sm">
            {searchItem || searchSite || searchManager ? "検索結果がありません" : "貸出記録がありません"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-3">貸出物</th>
                  <th className="py-2 pr-3">現場名</th>
                  <th className="py-2 pr-3">管理者</th>
                  <th className="py-2 pr-3">登録者</th>
                  <th className="py-2 pr-3">使用期間</th>
                  <th className="py-2 pr-3">入力日</th>
                  {isAdmin && <th className="py-2 pr-3">状態</th>}
                  <th className="py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {visibleRecords.map((r) => (
                  <tr key={r.id} className={`border-b last:border-b-0 hover:bg-gray-50 ${r.returned ? "opacity-50" : ""}`}>
                    <td className="py-2 pr-3 font-medium">{r.lending_items?.name}</td>
                    <td className="py-2 pr-3">{r.site_name}</td>
                    <td className="py-2 pr-3">{r.manager_name}</td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{r.registrant_name}</td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      {formatDate(r.period_start)}～{formatDate(r.period_end)}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                    {isAdmin && (
                      <td className="py-2 pr-3">
                        {r.returned ? (
                          <span className="text-xs text-green-600">返却済 {r.returned_at ? formatDateTime(r.returned_at) : ""}</span>
                        ) : (
                          <span className="text-xs text-orange-500 font-bold">貸出中</span>
                        )}
                      </td>
                    )}
                    <td className="py-2">
                      {!r.returned && (
                        <button
                          onClick={() => handleReturn(r.id)}
                          className="bg-green-100 hover:bg-green-200 text-green-700 text-xs px-3 py-1 rounded font-bold"
                        >
                          返却
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

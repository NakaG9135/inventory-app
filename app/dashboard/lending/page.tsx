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
  return_type: string;
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
  const [searchMasterItem, setSearchMasterItem] = useState("");

  // 現場名サジェスト
  const [showSiteSuggest, setShowSiteSuggest] = useState(false);

  // 貸出物管理セクション開閉
  const [showItemSection, setShowItemSection] = useState(false);

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
    const name = newItemName.trim();
    if (!name) return;

    // スペースと丸数字を除去してベース名を取得
    const normalize = (s: string) => s.replace(/\s+/g, "").replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]+$/, "");
    const normalizeAll = (s: string) => s.replace(/\s+/g, "");

    const nameNorm = normalizeAll(name);

    // 完全一致チェック（スペース差異も同一とみなす）
    const exact = lendingItems.find((item) => normalizeAll(item.name) === nameNorm);
    if (exact) {
      alert(`「${exact.name}」は既に登録されています。登録できません。`);
      return;
    }

    // 類似チェック: ベース名が同じ
    const baseName = normalize(name);
    const similar = lendingItems.filter((item) => normalize(item.name) === baseName);
    if (similar.length > 0) {
      const list = similar.map((s) => s.name).join("、");
      if (!confirm(`類似の貸出物があります:\n${list}\n\nそのまま「${name}」を追加しますか？`)) return;
    }

    await supabase.from("lending_items").insert({ name });
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

    const today = new Date().toISOString().slice(0, 10);
    if (formPeriodStart < today) {
      alert("使用期間（開始）に過去の日付は指定できません");
      return;
    }
    if (formPeriodEnd < formPeriodStart) {
      alert("使用期間（終了）は開始日以降を指定してください");
      return;
    }

    // 同じ貸出物の使用期間重複チェック
    const { data: existingRecords } = await supabase
      .from("lending_records")
      .select("*, lending_items(name)")
      .eq("lending_item_id", formItemId)
      .eq("returned", false);

    if (existingRecords && existingRecords.length > 0) {
      const overlapping = existingRecords.filter((r: any) =>
        formPeriodStart <= r.period_end && formPeriodEnd >= r.period_start
      );
      if (overlapping.length > 0) {
        const itemName = overlapping[0].lending_items?.name || "";
        const details = overlapping.map((r: any) =>
          `${r.site_name}（${r.period_start}～${r.period_end}）`
        ).join("\n");
        alert(`「${itemName}」は以下の期間で貸出中のため登録できません:\n${details}`);
        return;
      }

      // 同じ現場名＋同じ貸出物で日付が連続する場合、延長を提案
      const nextDay = (dateStr: string) => {
        const d = new Date(dateStr);
        d.setDate(d.getDate() + 1);
        return d.toISOString().slice(0, 10);
      };
      const consecutive = existingRecords.filter((r: any) =>
        r.site_name === formSiteName.trim() && nextDay(r.period_end) === formPeriodStart
      );
      if (consecutive.length > 0) {
        const rec = consecutive[0];
        const itemName = rec.lending_items?.name || "";
        if (confirm(
          `「${itemName}」は同じ現場「${rec.site_name}」で${rec.period_start}～${rec.period_end}まで貸出中です。\n\n使用期間を${rec.period_end}→${formPeriodEnd}に延長しますか？\n（「いいえ」を選ぶと新規登録します）`
        )) {
          await supabase.from("lending_records").update({
            period_end: formPeriodEnd,
          }).eq("id", rec.id);

          setFormItemId("");
          setFormSiteName("");
          setFormManager("");
          setFormPeriodStart("");
          setFormPeriodEnd("");
          setShowForm(false);
          fetchRecords();
          return;
        }
      }
    }

    // 類似現場名チェック
    const similar = pastSiteNames.filter((s) => s !== formSiteName.trim() && isFuzzyMatch(s, formSiteName.trim()));
    if (similar.length > 0) {
      const msg = `類似の現場名があります:\n${similar.join("\n")}\n\nそのまま「${formSiteName.trim()}」で登録しますか？`;
      if (!confirm(msg)) return;
    }

    // 現場リスト照合 → 未登録なら登録
    const { data: existingSite } = await supabase
      .from("material_reserve_sites")
      .select("id")
      .eq("site_name", formSiteName.trim())
      .single();

    if (!existingSite) {
      await supabase.from("material_reserve_sites").insert({
        site_name: formSiteName.trim(),
        manager_name: formManager,
      });
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
  const handleReturn = async (id: string, returnType: "通常" | "前倒し" | "admin代行") => {
    const msgs: Record<string, string> = {
      "前倒し": "期限前ですが、前倒しで返却しますか？",
      "通常": "この貸出物を返却しますか？",
      "admin代行": "管理者/登録者に確認済みとして、admin代行で返却しますか？",
    };
    if (!confirm(msgs[returnType])) return;
    await supabase.from("lending_records").update({
      returned: true,
      returned_at: new Date().toISOString(),
      return_type: returnType,
    }).eq("id", id);
    fetchRecords();
  };

  // Admin: 貸出記録の削除
  const handleDeleteRecord = async (id: string) => {
    if (!confirm("この貸出記録を削除しますか？")) return;
    await supabase.from("lending_records").delete().eq("id", id);
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
        <section className="bg-white border rounded-lg mb-6">
          <button
            onClick={() => setShowItemSection(!showItemSection)}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 rounded-lg"
          >
            <h2 className="text-sm font-semibold text-gray-500">貸出物の管理</h2>
            <span className="text-lg text-gray-400">{showItemSection ? "▲ 閉じる" : "▼ 開く"}</span>
          </button>
          <div className="flex gap-2 px-4 pb-3">
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
          {showItemSection && <div className="px-4 pb-4">
          <div className="mb-2">
            <input
              type="text"
              value={searchMasterItem}
              onChange={(e) => setSearchMasterItem(e.target.value)}
              placeholder="貸出物を検索"
              className="border rounded p-2 w-full text-sm"
            />
          </div>
          {lendingItems.length > 0 && (() => {
            const filtered = lendingItems.filter((item) =>
              !searchMasterItem || item.name.toLowerCase().includes(searchMasterItem.toLowerCase())
            );
            return filtered.length > 0 ? (
            <div className="space-y-1">
              {filtered.map((item) => (
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
            ) : (
              <p className="text-gray-400 text-sm">検索結果がありません</p>
            );
          })()}
          </div>}
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
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setFormPeriodStart(e.target.value)}
                className="border rounded p-2 w-full text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">使用期間（終了） *</label>
              <input
                type="date"
                value={formPeriodEnd}
                min={formPeriodStart || new Date().toISOString().slice(0, 10)}
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
                  <th className="py-2 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const todayStr = new Date().toISOString().slice(0, 10);
                  // 期限超過中の貸出物IDとその情報を収集
                  const overdueMap: Record<string, { site: string; end: string }> = {};
                  records.forEach((rec) => {
                    if (!rec.returned && todayStr > rec.period_end) {
                      overdueMap[rec.lending_item_id] = { site: rec.site_name, end: rec.period_end };
                    }
                  });
                  return [...visibleRecords].sort((a, b) => {
                    const aOver = !a.returned && todayStr > a.period_end ? 0 : 1;
                    const bOver = !b.returned && todayStr > b.period_end ? 0 : 1;
                    return aOver - bOver;
                  }).map((r) => {
                    const isOverdue = !r.returned && todayStr > r.period_end;
                    const overdueInfo = overdueMap[r.lending_item_id];
                    const isWaitingForOverdue = !r.returned && !isOverdue && overdueInfo && r.period_start > overdueInfo.end;
                    return (
                    <tr key={r.id} className={`border-b last:border-b-0 ${r.returned ? "opacity-50 hover:bg-gray-50" : isOverdue ? "bg-red-50 hover:bg-red-100" : isWaitingForOverdue ? "bg-orange-50 hover:bg-orange-100" : "hover:bg-gray-50"}`}>
                      <td className="py-2 pr-3 font-medium">
                        {r.lending_items?.name}
                        {isWaitingForOverdue && (
                          <span className="block text-xs text-orange-600 font-normal mt-0.5">
                            ⚠ 前の貸出（{overdueInfo.site}）が未返却です
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{r.site_name}</td>
                      <td className="py-2 pr-3">{r.manager_name}</td>
                      <td className="py-2 pr-3 text-xs text-gray-500">{r.registrant_name}</td>
                      <td className={`py-2 pr-3 text-xs whitespace-nowrap ${isOverdue ? "text-red-600 font-bold" : isWaitingForOverdue ? "text-orange-600" : ""}`}>
                        {formatDate(r.period_start)}～{formatDate(r.period_end)}
                        {isOverdue && " ※返却期限超過"}
                      </td>
                    <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                    {isAdmin && (
                      <td className="py-2 pr-3">
                        {r.returned ? (
                          <span className="text-xs text-green-600">
                            {r.return_type === "前倒し" ? "前倒し返却" : r.return_type === "admin代行" ? "admin代行返却" : "返却済"} {r.returned_at ? formatDateTime(r.returned_at) : ""}
                          </span>
                        ) : isOverdue ? (
                          <span className="text-xs text-red-600 font-bold">期限超過</span>
                        ) : todayStr < r.period_start ? (
                          <span className="text-xs text-blue-500 font-bold">貸出待ち</span>
                        ) : (
                          <span className="text-xs text-orange-500 font-bold">貸出中</span>
                        )}
                      </td>
                    )}
                    <td className="py-2">
                      <div className="flex gap-1">
                        {!r.returned && (r.manager_name === currentUserName || r.registrant_name === currentUserName) && (() => {
                          const today = new Date().toISOString().slice(0, 10);
                          const isBeforeDeadline = today <= r.period_end;
                          return isBeforeDeadline ? (
                            <button
                              onClick={() => handleReturn(r.id, "前倒し")}
                              className="bg-yellow-100 hover:bg-yellow-200 text-yellow-700 text-xs px-3 py-1 rounded font-bold whitespace-nowrap"
                            >
                              前倒し返却
                            </button>
                          ) : (
                            <button
                              onClick={() => handleReturn(r.id, "通常")}
                              className="bg-green-100 hover:bg-green-200 text-green-700 text-xs px-3 py-1 rounded font-bold"
                            >
                              返却
                            </button>
                          );
                        })()}
                        {isAdmin && !r.returned && (
                          <button
                            onClick={() => handleReturn(r.id, "admin代行")}
                            className="bg-purple-100 hover:bg-purple-200 text-purple-700 text-xs px-3 py-1 rounded font-bold whitespace-nowrap"
                          >
                            admin返却
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={() => handleDeleteRecord(r.id)}
                            className="bg-red-100 hover:bg-red-200 text-red-600 text-xs px-3 py-1 rounded font-bold"
                          >
                            削除
                          </button>
                        )}
                      </div>
                    </td>
                    </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

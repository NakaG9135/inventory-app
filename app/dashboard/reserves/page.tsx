"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

interface ReserveSite {
  id: string;
  site_name: string;
  manager_name: string;
  created_at: string;
  items: ReserveItem[];
}

interface ReserveItem {
  id: string;
  item_id: string;
  quantity: number;
  operator_name: string;
  planned_date: string;
  updated_at: string;
  inventory: {
    type: string;
    maker: string;
    detail: string;
    unit: string;
  } | null;
}

interface ReserveLog {
  id: string;
  operator_name: string;
  quantity: number;
  created_at: string;
}

export default function ReservesPage() {
  const [sites, setSites] = useState<ReserveSite[]>([]);
  const [openSiteId, setOpenSiteId] = useState<string | null>(null);
  const [logModal, setLogModal] = useState<{ item: ReserveItem; logs: ReserveLog[] } | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>("");
  const [currentUserRole, setCurrentUserRole] = useState<string>("");
  const [searchCategory, setSearchCategory] = useState("");
  const [searchManufacturer, setSearchManufacturer] = useState("");
  const [searchDetail, setSearchDetail] = useState("");
  const [editDateModal, setEditDateModal] = useState<{ itemId: string; year: string; month: string; day: string } | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from("users_profile").select("name, role").eq("id", user.id).single();
        if (data) {
          setCurrentUserName(data.name);
          setCurrentUserRole(data.role);
        }
      }
    };
    fetchUser();
  }, []);

  const fetchSites = async () => {
    const { data: sitesData } = await supabase
      .from("material_reserve_sites")
      .select("*")
      .order("created_at", { ascending: false });

    if (!sitesData) return;

    const sitesWithItems: ReserveSite[] = [];
    for (const site of sitesData) {
      const { data: itemsData } = await supabase
        .from("material_reserve_items")
        .select("*, inventory(type, maker, detail, unit)")
        .eq("site_id", site.id)
        .order("updated_at", { ascending: false });

      sitesWithItems.push({
        ...site,
        items: (itemsData || []) as ReserveItem[],
      });
    }
    setSites(sitesWithItems);
  };

  const isExpired = (plannedDate: string) => {
    if (!plannedDate) return false;
    const parts = plannedDate.split("-");
    const now = new Date();
    if (parts.length === 3) {
      // 年-月-日: 今日より前
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return d < today;
    } else if (parts.length === 2) {
      // 年-月: 当月より前
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
      const cur = new Date(now.getFullYear(), now.getMonth(), 1);
      return d < cur;
    }
    return false;
  };

  useEffect(() => {
    fetchSites();
  }, []);

  const handleShowLogs = async (item: ReserveItem) => {
    const { data } = await supabase
      .from("material_reserve_logs")
      .select("*")
      .eq("reserve_item_id", item.id)
      .order("created_at", { ascending: false });

    setLogModal({ item, logs: (data || []) as ReserveLog[] });
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm("この確保品を削除しますか？")) return;
    await supabase.from("material_reserve_items").delete().eq("id", itemId);
    fetchSites();
  };

  const handleDeleteSite = async (siteId: string) => {
    if (!confirm("この現場と全ての確保品を削除しますか？")) return;
    await supabase.from("material_reserve_sites").delete().eq("id", siteId);
    fetchSites();
  };

  const openEditDate = (item: ReserveItem) => {
    const parts = item.planned_date ? item.planned_date.split("-") : [];
    setEditDateModal({
      itemId: item.id,
      year: parts[0] || "",
      month: parts[1] ? String(Number(parts[1])) : "",
      day: parts[2] ? String(Number(parts[2])) : "",
    });
  };

  const handleUpdateDate = async () => {
    if (!editDateModal) return;
    const { itemId, year, month, day } = editDateModal;
    if (!year || !month) {
      alert("年と月は必須です");
      return;
    }
    const now = new Date();
    const isSameYearMonth = Number(year) === now.getFullYear() && Number(month) === now.getMonth() + 1;
    if (isSameYearMonth && !day) {
      alert("当月の場合は日の入力も必須です");
      return;
    }
    if (day) {
      const inputDate = new Date(Number(year), Number(month) - 1, Number(day));
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (inputDate < today) {
        alert("使用予定日に過去の日付は指定できません");
        return;
      }
    } else {
      const inputMonth = new Date(Number(year), Number(month) - 1, 1);
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      if (inputMonth < currentMonth) {
        alert("使用予定日に過去の年月は指定できません");
        return;
      }
    }
    const newDate = `${year}-${month.padStart(2, "0")}${day ? "-" + day.padStart(2, "0") : ""}`;
    await supabase.from("material_reserve_items").update({ planned_date: newDate, updated_at: new Date().toISOString() }).eq("id", itemId);
    setEditDateModal(null);
    fetchSites();
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const filterItem = (item: ReserveItem) => {
    const inv = item.inventory;
    if (!inv) return false;
    if (searchCategory && !inv.type.toLowerCase().includes(searchCategory.toLowerCase())) return false;
    if (searchManufacturer && !inv.maker.toLowerCase().includes(searchManufacturer.toLowerCase())) return false;
    if (searchDetail && !inv.detail.toLowerCase().includes(searchDetail.toLowerCase())) return false;
    return true;
  };

  const hasSearch = searchCategory || searchManufacturer || searchDetail;
  const filteredSites = hasSearch
    ? sites.map((s) => ({ ...s, items: s.items.filter(filterItem) })).filter((s) => s.items.length > 0)
    : sites;

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-6">材料確保</h1>

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

      {/* 操作履歴モーダル */}
      {logModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-[28rem] max-h-[80vh] flex flex-col">
            <h2 className="text-base font-bold mb-1">操作履歴</h2>
            <div className="text-sm text-gray-700 bg-gray-50 rounded p-2 mb-4">
              {logModal.item.inventory?.type}　{logModal.item.inventory?.maker}　{logModal.item.inventory?.detail}
              <span className="ml-2 text-gray-400 text-xs">
                （合計: {logModal.item.quantity} {logModal.item.inventory?.unit}）
              </span>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0">
              {logModal.logs.length === 0 ? (
                <p className="text-gray-400 text-sm">履歴がありません</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="py-2 pr-3">日時</th>
                      <th className="py-2 pr-3">操作者</th>
                      <th className="py-2 text-center">数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logModal.logs.map((log) => (
                      <tr key={log.id} className="border-b last:border-b-0">
                        <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(log.created_at)}</td>
                        <td className="py-2 pr-3">{log.operator_name}</td>
                        <td className="py-2 text-center font-bold">{log.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <button
              onClick={() => setLogModal(null)}
              className="mt-4 w-full bg-gray-300 hover:bg-gray-400 text-gray-700 py-2 rounded text-sm"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {filteredSites.length === 0 ? (
        <p className="text-gray-400 text-sm">{hasSearch ? "検索結果がありません" : "確保された材料はありません"}</p>
      ) : (
        <div className="space-y-4">
          {filteredSites.map((site) => (
            <div key={site.id} className="bg-white border rounded-lg overflow-hidden">
              {/* 現場ヘッダー */}
              <button
                onClick={() => setOpenSiteId(openSiteId === site.id ? null : site.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50 text-left"
              >
                <div>
                  <span className="font-bold text-base">{site.site_name}</span>
                  <span className="text-xs text-gray-400 ml-3">管理者: {site.manager_name}</span>
                  <span className="text-xs text-gray-400 ml-3">{site.items.length}品目</span>
                </div>
                <span className="text-gray-400 text-sm">{openSiteId === site.id ? "▲" : "▼"}</span>
              </button>

              {/* 確保品一覧 */}
              {openSiteId === site.id && (
                <div className="border-t px-4 pb-4">
                  {site.items.length === 0 ? (
                    <p className="text-gray-400 text-sm py-3">確保品なし</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm mt-2">
                        <thead>
                          <tr className="border-b text-left text-gray-500">
                            <th className="py-2 pr-3">種類</th>
                            <th className="py-2 pr-3">メーカー</th>
                            <th className="py-2 pr-3">詳細</th>
                            <th className="py-2 pr-3 text-center">数量</th>
                            <th className="py-2 pr-3">使用予定</th>
                            <th className="py-2 w-16"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...site.items].sort((a, b) => {
                            const aExp = isExpired(a.planned_date) ? 0 : 1;
                            const bExp = isExpired(b.planned_date) ? 0 : 1;
                            return aExp - bExp;
                          }).map((item) => {
                            const expired = isExpired(item.planned_date);
                            return (
                            <tr
                              key={item.id}
                              className={`border-b last:border-b-0 cursor-pointer ${expired ? "bg-red-50 hover:bg-red-100" : "hover:bg-blue-50"}`}
                              onClick={() => handleShowLogs(item)}
                            >
                              <td className="py-2 pr-3">{item.inventory?.type}</td>
                              <td className="py-2 pr-3">{item.inventory?.maker}</td>
                              <td className="py-2 pr-3">{item.inventory?.detail}</td>
                              <td className="py-2 pr-3 text-center font-bold">
                                {item.quantity} {item.inventory?.unit}
                              </td>
                              <td className={`py-2 pr-3 text-xs whitespace-nowrap ${expired ? "text-red-600 font-bold" : "text-gray-600"}`}>
                                {item.planned_date ? item.planned_date.replace(/-/g, "/") : ""}
                                {expired && " ※期限超過"}
                                {(currentUserRole === "admin" || currentUserName === site.manager_name) && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); openEditDate(item); }}
                                    className="ml-1 text-blue-500 hover:text-blue-700 text-xs"
                                  >
                                    変更
                                  </button>
                                )}
                              </td>
                              <td className="py-2">
                                {(currentUserRole === "admin" || currentUserName === site.manager_name) && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id); }}
                                    className="text-red-400 hover:text-red-600 text-xs"
                                  >
                                    削除
                                  </button>
                                )}
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {(currentUserRole === "admin" || currentUserName === site.manager_name) && (
                    <div className="mt-3 text-right">
                      <button
                        onClick={() => handleDeleteSite(site.id)}
                        className="text-red-400 hover:text-red-600 text-xs"
                      >
                        この現場を削除
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {/* 使用予定日変更モーダル */}
      {editDateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-sm font-bold mb-4">使用予定日を変更</h3>
            <div className="flex items-center gap-1 mb-4">
              <input
                type="number"
                value={editDateModal.year}
                onChange={(e) => setEditDateModal((p) => p && { ...p, year: e.target.value })}
                placeholder="年"
                className="border rounded p-2 w-20 text-sm text-center"
                min="2024" max="2099"
              />
              <span className="text-sm shrink-0">年</span>
              <input
                type="number"
                value={editDateModal.month}
                onChange={(e) => setEditDateModal((p) => p && { ...p, month: e.target.value })}
                placeholder="月"
                className="border rounded p-2 w-16 text-sm text-center"
                min="1" max="12"
              />
              <span className="text-sm shrink-0">月</span>
              <input
                type="number"
                value={editDateModal.day}
                onChange={(e) => setEditDateModal((p) => p && { ...p, day: e.target.value })}
                placeholder="日"
                className="border rounded p-2 w-16 text-sm text-center"
                min="1" max="31"
              />
              <span className="text-sm shrink-0">日</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleUpdateDate}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded text-sm font-bold"
              >
                変更
              </button>
              <button
                onClick={() => setEditDateModal(null)}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 py-2 rounded text-sm"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

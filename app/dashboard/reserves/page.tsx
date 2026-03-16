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

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-6">材料確保</h1>

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

      {sites.length === 0 ? (
        <p className="text-gray-400 text-sm">確保された材料はありません</p>
      ) : (
        <div className="space-y-4">
          {sites.map((site) => (
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
                            <th className="py-2 w-16"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {site.items.map((item) => (
                            <tr
                              key={item.id}
                              className="border-b last:border-b-0 hover:bg-blue-50 cursor-pointer"
                              onClick={() => handleShowLogs(item)}
                            >
                              <td className="py-2 pr-3">{item.inventory?.type}</td>
                              <td className="py-2 pr-3">{item.inventory?.maker}</td>
                              <td className="py-2 pr-3">{item.inventory?.detail}</td>
                              <td className="py-2 pr-3 text-center font-bold">
                                {item.quantity} {item.inventory?.unit}
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
                          ))}
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
    </div>
  );
}

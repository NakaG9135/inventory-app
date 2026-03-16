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

export default function ReservesPage() {
  const [sites, setSites] = useState<ReserveSite[]>([]);
  const [openSiteId, setOpenSiteId] = useState<string | null>(null);

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

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-6">材料確保</h1>

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
                            <th className="py-2 pr-3">操作者</th>
                            <th className="py-2 w-16"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {site.items.map((item) => (
                            <tr key={item.id} className="border-b last:border-b-0 hover:bg-gray-50">
                              <td className="py-2 pr-3">{item.inventory?.type}</td>
                              <td className="py-2 pr-3">{item.inventory?.maker}</td>
                              <td className="py-2 pr-3">{item.inventory?.detail}</td>
                              <td className="py-2 pr-3 text-center font-bold">
                                {item.quantity} {item.inventory?.unit}
                              </td>
                              <td className="py-2 pr-3 text-xs text-gray-500">{item.operator_name}</td>
                              <td className="py-2">
                                <button
                                  onClick={() => handleDeleteItem(item.id)}
                                  className="text-red-400 hover:text-red-600 text-xs"
                                >
                                  削除
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="mt-3 text-right">
                    <button
                      onClick={() => handleDeleteSite(site.id)}
                      className="text-red-400 hover:text-red-600 text-xs"
                    >
                      この現場を削除
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

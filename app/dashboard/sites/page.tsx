"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

interface SiteInfo {
  siteName: string;
  address: string;
  officeLocation: string;
  manager: string;
  enteredWorkers: string[];
}

export default function SitesPage() {
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [currentUserName, setCurrentUserName] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState("");
  const [openSiteName, setOpenSiteName] = useState<string | null>(null);
  const [editingSite, setEditingSite] = useState<string | null>(null);
  const [editAddress, setEditAddress] = useState("");
  const [editOffice, setEditOffice] = useState("");
  const [editManager, setEditManager] = useState("");
  const [workers, setWorkers] = useState<string[]>([]);
  const [searchSite, setSearchSite] = useState("");
  const [loading, setLoading] = useState(true);

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
    const fetchWorkers = async () => {
      const { data } = await supabase.from("users_profile").select("name").order("name");
      if (data) setWorkers(data.map((d: any) => d.name));
    };
    fetchWorkers();
  }, []);

  useEffect(() => {
    fetchSites();
  }, []);

  const fetchSites = async () => {
    setLoading(true);

    // 1. 全現場名を収集（入出庫ログ、日報、材料確保）
    const [logsRes, reportsRes, reservesRes] = await Promise.all([
      supabase.from("inventory_logs").select("site_name").not("site_name", "is", null),
      supabase.from("daily_reports").select("site_name").not("site_name", "is", null),
      supabase.from("material_reserve_sites").select("site_name"),
    ]);

    const allSiteNames = new Set<string>();
    (logsRes.data || []).forEach((d: any) => d.site_name && allSiteNames.add(d.site_name));
    (reportsRes.data || []).forEach((d: any) => d.site_name && allSiteNames.add(d.site_name));
    (reservesRes.data || []).forEach((d: any) => d.site_name && allSiteNames.add(d.site_name));

    // 2. 管理者を取得（材料確保の現場から）
    const { data: reserveSites } = await supabase.from("material_reserve_sites").select("site_name, manager_name");
    const managerMap: Record<string, string> = {};
    (reserveSites || []).forEach((s: any) => {
      if (s.manager_name) managerMap[s.site_name] = s.manager_name;
    });

    // 3. 確定済み日報から現場ごとの作業員を取得
    const { data: confirmedReports } = await supabase
      .from("daily_reports")
      .select("site_name, workers")
      .eq("status", "confirmed");

    const workersMap: Record<string, Set<string>> = {};
    (confirmedReports || []).forEach((r: any) => {
      if (!r.site_name || !r.workers) return;
      if (!workersMap[r.site_name]) workersMap[r.site_name] = new Set();
      (r.workers as string[]).forEach((w) => w && workersMap[r.site_name].add(w));
    });

    // 4. site_details（住所・事務所）を取得
    const { data: details } = await supabase.from("site_details").select("*");
    const detailsMap: Record<string, { address: string; officeLocation: string }> = {};
    (details || []).forEach((d: any) => {
      detailsMap[d.site_name] = { address: d.address || "", officeLocation: d.office_location || "" };
    });

    // 5. 統合
    const siteList: SiteInfo[] = [...allSiteNames].sort().map((name) => ({
      siteName: name,
      address: detailsMap[name]?.address || "",
      officeLocation: detailsMap[name]?.officeLocation || "",
      manager: managerMap[name] || "",
      enteredWorkers: workersMap[name] ? [...workersMap[name]].sort() : [],
    }));

    setSites(siteList);
    setLoading(false);
  };

  const canEdit = (site: SiteInfo) => {
    return currentUserRole === "admin" || currentUserName === site.manager;
  };

  const handleStartEdit = (site: SiteInfo) => {
    setEditingSite(site.siteName);
    setEditAddress(site.address);
    setEditOffice(site.officeLocation);
    setEditManager(site.manager);
  };

  const handleSaveDetails = async (siteName: string) => {
    // upsert site_details
    const { data: existing } = await supabase
      .from("site_details")
      .select("id")
      .eq("site_name", siteName)
      .single();

    if (existing) {
      await supabase.from("site_details").update({
        address: editAddress.trim(),
        office_location: editOffice.trim(),
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      await supabase.from("site_details").insert({
        site_name: siteName,
        address: editAddress.trim(),
        office_location: editOffice.trim(),
      });
    }

    // adminのみ管理者を変更
    if (currentUserRole === "admin" && editManager.trim()) {
      const { data: existingSite } = await supabase
        .from("material_reserve_sites")
        .select("id")
        .eq("site_name", siteName)
        .single();

      if (existingSite) {
        await supabase.from("material_reserve_sites").update({
          manager_name: editManager.trim(),
        }).eq("id", existingSite.id);
      }
    }

    setEditingSite(null);
    fetchSites();
  };

  const filteredSites = sites.filter((s) =>
    !searchSite || s.siteName.toLowerCase().includes(searchSite.toLowerCase())
  );

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-6">現場リスト</h1>

      {/* 検索 */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="現場名で検索"
          value={searchSite}
          onChange={(e) => setSearchSite(e.target.value)}
          className="border rounded p-2 w-full text-sm"
        />
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">読み込み中...</p>
      ) : filteredSites.length === 0 ? (
        <p className="text-gray-400 text-sm">
          {searchSite ? "検索結果がありません" : "現場データがありません"}
        </p>
      ) : (
        <div className="space-y-3">
          {filteredSites.map((site) => (
            <div key={site.siteName} className="bg-white border rounded-lg">
              {/* ヘッダー */}
              <button
                onClick={() => setOpenSiteName(openSiteName === site.siteName ? null : site.siteName)}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50 rounded-lg"
              >
                <div className="text-left">
                  <span className="font-bold text-sm">{site.siteName}</span>
                  {site.manager && (
                    <span className="ml-3 text-xs text-gray-500">管理者: {site.manager}</span>
                  )}
                </div>
                <span className="text-gray-400">{openSiteName === site.siteName ? "▲" : "▼"}</span>
              </button>

              {/* 詳細 */}
              {openSiteName === site.siteName && (
                <div className="px-4 pb-4 border-t">
                  {/* 住所・事務所 */}
                  {editingSite === site.siteName ? (
                    <div className="mt-3 space-y-2">
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">現場住所</label>
                        <input
                          type="text"
                          value={editAddress}
                          onChange={(e) => setEditAddress(e.target.value)}
                          placeholder="住所を入力"
                          className="border rounded p-2 w-full text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">現場事務所の場所</label>
                        <input
                          type="text"
                          value={editOffice}
                          onChange={(e) => setEditOffice(e.target.value)}
                          placeholder="事務所の場所を入力"
                          className="border rounded p-2 w-full text-sm"
                        />
                      </div>
                      {currentUserRole === "admin" && (
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">管理者</label>
                          <select
                            value={editManager}
                            onChange={(e) => setEditManager(e.target.value)}
                            className="border rounded p-2 w-full text-sm"
                          >
                            <option value="">選択してください</option>
                            {workers.map((w) => (
                              <option key={w} value={w}>{w}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSaveDetails(site.siteName)}
                          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-bold"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditingSite(null)}
                          className="bg-gray-300 hover:bg-gray-400 text-gray-700 px-4 py-1.5 rounded text-sm"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-1">
                      <div className="flex text-sm">
                        <span className="text-gray-500 w-32 shrink-0">現場住所:</span>
                        {site.address ? (
                          <a
                            href={`https://maps.google.com/maps?q=${encodeURIComponent(site.address)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:text-blue-700 underline"
                          >
                            {site.address}
                          </a>
                        ) : (
                          <span>未登録</span>
                        )}
                      </div>
                      <div className="flex text-sm">
                        <span className="text-gray-500 w-32 shrink-0">事務所の場所:</span>
                        <span>{site.officeLocation || "未登録"}</span>
                      </div>
                      <div className="flex text-sm">
                        <span className="text-gray-500 w-32 shrink-0">管理者:</span>
                        <span>{site.manager || "未登録"}</span>
                      </div>
                      {canEdit(site) && (
                        <button
                          onClick={() => handleStartEdit(site)}
                          className="text-blue-500 hover:text-blue-700 text-xs mt-1"
                        >
                          編集
                        </button>
                      )}
                    </div>
                  )}

                  {/* 新規入場済み者 */}
                  <div className="mt-4">
                    <h3 className="text-xs text-gray-500 font-semibold mb-2">
                      新規入場済み者（{site.enteredWorkers.length}名）
                    </h3>
                    {site.enteredWorkers.length === 0 ? (
                      <p className="text-gray-400 text-xs">まだ作業実績がありません</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {site.enteredWorkers.map((w) => (
                          <span
                            key={w}
                            className="bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded"
                          >
                            {w}
                          </span>
                        ))}
                      </div>
                    )}
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

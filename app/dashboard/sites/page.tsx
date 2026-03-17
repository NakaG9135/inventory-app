"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

interface SiteInfo {
  siteName: string;
  companyName: string;
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
  const [editCompany, setEditCompany] = useState("");
  const [registeredCompanies, setRegisteredCompanies] = useState<string[]>([]);
  const [workers, setWorkers] = useState<string[]>([]);
  const [searchSite, setSearchSite] = useState("");
  const [loading, setLoading] = useState(true);

  // 会社名マスタ管理
  const [showCompanySection, setShowCompanySection] = useState(false);
  const [editingCompanyOld, setEditingCompanyOld] = useState<string | null>(null);
  const [editingCompanyNew, setEditingCompanyNew] = useState("");

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

    // 2. 管理者・会社名を取得（材料確保の現場から）
    const { data: reserveSites } = await supabase.from("material_reserve_sites").select("site_name, manager_name, company_name");
    const managerMap: Record<string, string> = {};
    const companyMap: Record<string, string> = {};
    (reserveSites || []).forEach((s: any) => {
      if (s.manager_name) managerMap[s.site_name] = s.manager_name;
      if (s.company_name) companyMap[s.site_name] = s.company_name;
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
      companyName: companyMap[name] || "",
      address: detailsMap[name]?.address || "",
      officeLocation: detailsMap[name]?.officeLocation || "",
      manager: managerMap[name] || "",
      enteredWorkers: workersMap[name] ? [...workersMap[name]].sort() : [],
    }));

    setSites(siteList);
    setRegisteredCompanies([...new Set(Object.values(companyMap))].filter(Boolean).sort());
    setLoading(false);
  };

  const canEdit = (site: SiteInfo) => {
    return currentUserRole === "admin" || currentUserName === site.manager;
  };

  const [editSiteName, setEditSiteName] = useState("");

  const handleStartEdit = (site: SiteInfo) => {
    setEditingSite(site.siteName);
    setEditSiteName(site.siteName);
    setEditAddress(site.address);
    setEditOffice(site.officeLocation);
    setEditManager(site.manager);
    setEditCompany(site.companyName);
  };

  const handleSaveDetails = async (oldSiteName: string) => {
    const newSiteName = editSiteName.trim();
    const siteRenamed = currentUserRole === "admin" && newSiteName && newSiteName !== oldSiteName;

    // 現場名変更の場合、類似チェック
    if (siteRenamed) {
      const existsAlready = sites.find((s) => s.siteName === newSiteName);
      if (existsAlready) {
        alert(`「${newSiteName}」は既に存在します。別の名前を入力してください。`);
        return;
      }
      const similar = sites.filter((s) =>
        s.siteName !== oldSiteName &&
        (s.siteName.toLowerCase().includes(newSiteName.toLowerCase()) || newSiteName.toLowerCase().includes(s.siteName.toLowerCase()))
      );
      if (similar.length > 0) {
        const list = similar.map((s) => s.siteName).join("\n");
        if (!confirm(`類似の現場名があります:\n${list}\n\nそのまま「${newSiteName}」に変更しますか？`)) return;
      }
      if (!confirm(`現場名を「${oldSiteName}」→「${newSiteName}」に変更しますか？\n関連する全てのデータが更新されます。`)) return;
    }

    const targetSiteName = siteRenamed ? newSiteName : oldSiteName;

    // upsert site_details
    const { data: existing } = await supabase
      .from("site_details")
      .select("id")
      .eq("site_name", oldSiteName)
      .single();

    if (existing) {
      await supabase.from("site_details").update({
        site_name: targetSiteName,
        address: editAddress.trim(),
        office_location: editOffice.trim(),
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      await supabase.from("site_details").insert({
        site_name: targetSiteName,
        address: editAddress.trim(),
        office_location: editOffice.trim(),
      });
    }

    // adminのみ管理者・会社名を変更
    if (currentUserRole === "admin") {
      const { data: existingSite } = await supabase
        .from("material_reserve_sites")
        .select("id")
        .eq("site_name", oldSiteName)
        .single();

      if (existingSite) {
        const updateData: any = { site_name: targetSiteName };
        if (editManager.trim()) updateData.manager_name = editManager.trim();
        if (editCompany !== undefined) updateData.company_name = editCompany.trim();
        await supabase.from("material_reserve_sites").update(updateData).eq("id", existingSite.id);
      }
    }

    // 現場名変更の場合、全テーブルを一括更新
    if (siteRenamed) {
      await Promise.all([
        supabase.from("daily_reports").update({ site_name: newSiteName }).eq("site_name", oldSiteName),
        supabase.from("inventory_logs").update({ site_name: newSiteName }).eq("site_name", oldSiteName),
        supabase.from("lending_records").update({ site_name: newSiteName }).eq("site_name", oldSiteName),
        supabase.from("material_reserve_items").select("id, site_id").then(() => {}), // items are linked by site_id FK, no update needed
      ]);
    }

    setEditingSite(null);
    fetchSites();
  };

  // 会社名の編集（全テーブルの該当レコードを一括更新）
  const handleRenameCompany = async (oldName: string) => {
    const newName = editingCompanyNew.trim();
    if (!newName || newName === oldName) { setEditingCompanyOld(null); return; }

    const similar = registeredCompanies.filter((c) =>
      c !== oldName && (c.toLowerCase().includes(newName.toLowerCase()) || newName.toLowerCase().includes(c.toLowerCase()))
    );
    if (similar.length > 0) {
      if (!confirm(`類似の会社名があります:\n${similar.join("\n")}\n\nそのまま「${newName}」に変更しますか？`)) return;
    }

    if (!confirm(`会社名を「${oldName}」→「${newName}」に変更しますか？\n関連する全てのデータが更新されます。`)) return;

    await Promise.all([
      supabase.from("material_reserve_sites").update({ company_name: newName }).eq("company_name", oldName),
      supabase.from("daily_reports").update({ company_name: newName }).eq("company_name", oldName),
      supabase.from("inventory_logs").update({ company_name: newName }).eq("company_name", oldName),
      supabase.from("lending_records").update({ company_name: newName }).eq("company_name", oldName),
      supabase.from("site_details").update({ company_name: newName }).eq("company_name", oldName),
    ]);

    setEditingCompanyOld(null);
    setEditingCompanyNew("");
    fetchSites();
  };

  const handleDeleteCompany = async (name: string) => {
    if (!confirm(`会社名「${name}」を削除しますか？\n関連する全てのデータから会社名が空欄になります。`)) return;

    await Promise.all([
      supabase.from("material_reserve_sites").update({ company_name: "" }).eq("company_name", name),
      supabase.from("daily_reports").update({ company_name: "" }).eq("company_name", name),
      supabase.from("inventory_logs").update({ company_name: "" }).eq("company_name", name),
      supabase.from("lending_records").update({ company_name: "" }).eq("company_name", name),
      supabase.from("site_details").update({ company_name: "" }).eq("company_name", name),
    ]);

    fetchSites();
  };

  const filteredSites = sites.filter((s) =>
    !searchSite || s.siteName.toLowerCase().includes(searchSite.toLowerCase())
  );

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-6">現場リスト</h1>

      {/* Admin: 会社名マスタ管理 */}
      {currentUserRole === "admin" && (
        <section className="bg-white border rounded-lg mb-6">
          <button
            onClick={() => setShowCompanySection(!showCompanySection)}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 rounded-lg"
          >
            <h2 className="text-sm font-semibold text-gray-500">会社名マスタ管理</h2>
            <span className="text-lg text-gray-400">{showCompanySection ? "▲ 閉じる" : "▼ 開く"}</span>
          </button>
          {showCompanySection && (
            <div className="px-4 pb-4">
              {registeredCompanies.length === 0 ? (
                <p className="text-gray-400 text-sm">登録されている会社名がありません</p>
              ) : (
                <div className="space-y-1">
                  {registeredCompanies.map((c) => (
                    <div key={c} className="flex items-center gap-2 py-1.5 border-b last:border-b-0">
                      {editingCompanyOld === c ? (
                        <>
                          <input
                            type="text"
                            value={editingCompanyNew}
                            onChange={(e) => setEditingCompanyNew(e.target.value)}
                            className="border rounded p-1 flex-1 min-w-0 text-sm"
                          />
                          <button onClick={() => handleRenameCompany(c)} className="text-blue-500 text-xs shrink-0">保存</button>
                          <button onClick={() => setEditingCompanyOld(null)} className="text-gray-400 text-xs shrink-0">取消</button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm">{c}</span>
                          <span className="text-xs text-gray-400 shrink-0">
                            {sites.filter((s) => s.companyName === c).length}現場
                          </span>
                          <button
                            onClick={() => { setEditingCompanyOld(c); setEditingCompanyNew(c); }}
                            className="text-blue-500 text-xs shrink-0"
                          >編集</button>
                          <button
                            onClick={() => handleDeleteCompany(c)}
                            className="text-red-400 text-xs shrink-0"
                          >削除</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

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
                  {site.companyName && (
                    <span className="ml-2 text-xs text-gray-400">({site.companyName})</span>
                  )}
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
                      {currentUserRole === "admin" && (
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">現場名</label>
                          <input
                            type="text"
                            value={editSiteName}
                            onChange={(e) => setEditSiteName(e.target.value)}
                            className="border rounded p-2 w-full text-sm"
                          />
                        </div>
                      )}
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
                        <>
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">会社名</label>
                            <select
                              value={editCompany}
                              onChange={(e) => {
                                if (e.target.value === "__new__") {
                                  const name = prompt("新しい会社名を入力してください");
                                  if (name && name.trim()) {
                                    const trimmed = name.trim();
                                    const exact = registeredCompanies.find((c) => c === trimmed);
                                    if (exact) { setEditCompany(exact); }
                                    else {
                                      const similar = registeredCompanies.filter((c) =>
                                        c.toLowerCase().includes(trimmed.toLowerCase()) || trimmed.toLowerCase().includes(c.toLowerCase())
                                      );
                                      if (similar.length > 0) {
                                        const msg = `類似の会社名があります:\n${similar.join("\n")}\n\nそのまま「${trimmed}」を新規登録しますか？`;
                                        if (!confirm(msg)) return;
                                      } else {
                                        if (!confirm(`「${trimmed}」を新しい会社名として登録しますか？`)) return;
                                      }
                                      setEditCompany(trimmed);
                                      setRegisteredCompanies((prev) => [...prev, trimmed].sort());
                                    }
                                  }
                                } else {
                                  setEditCompany(e.target.value);
                                }
                              }}
                              className="border rounded p-2 w-full text-sm"
                            >
                              <option value="">選択してください</option>
                              {registeredCompanies.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                              <option value="__new__">＋ 新しい会社名を追加</option>
                            </select>
                          </div>
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
                        </>
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
                        <span className="text-gray-500 w-32 shrink-0">会社名:</span>
                        <span>{site.companyName || "未登録"}</span>
                      </div>
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

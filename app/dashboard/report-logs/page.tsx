"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import * as XLSX from "xlsx";

interface ReportMaterial {
  id: string;
  quantity: number;
  group_index: number | null;
  inventory: {
    type: string;
    maker: string;
    detail: string;
    unit: string;
  } | null;
}

interface Report {
  id: string;
  company_name: string;
  site_name: string;
  work_date: string;
  work_time: string | null;
  vehicles: string[];
  workers: string[];
  work_description: string | null;
  material_group_labels: string[] | null;
  created_at: string;
  user_id: string;
  status: string;
  daily_report_materials: ReportMaterial[];
}

export default function ReportLogsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [userNames, setUserNames] = useState<{ [id: string]: string }>({});
  const [filterSite, setFilterSite] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterWorker, setFilterWorker] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showFilterSiteSuggest, setShowFilterSiteSuggest] = useState(false);

  // Excel出力用
  const [exportSite, setExportSite] = useState("");
  const [exportDateFrom, setExportDateFrom] = useState("");
  const [exportDateTo, setExportDateTo] = useState("");
  const [pastSiteNames, setPastSiteNames] = useState<string[]>([]);
  const [showExportSiteSuggest, setShowExportSiteSuggest] = useState(false);
  const [registeredCompanies, setRegisteredCompanies] = useState<string[]>([]);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingCompanyValue, setEditingCompanyValue] = useState("");

  useEffect(() => {
    const checkRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from("users_profile").select("role").eq("id", user.id).single();
        if (data?.role === "admin") setIsAdmin(true);
      }
    };
    checkRole();
    const fetchSiteNames = async () => {
      const [logs, reports, reserves] = await Promise.all([
        supabase.from("inventory_logs").select("site_name, company_name").not("site_name", "is", null),
        supabase.from("daily_reports").select("site_name, company_name").not("site_name", "is", null),
        supabase.from("material_reserve_sites").select("site_name, company_name"),
      ]);
      const allEntries = [...(logs.data || []), ...(reports.data || []), ...(reserves.data || [])].filter((d: any) => d.site_name);
      setPastSiteNames([...new Set(allEntries.map((d: any) => d.site_name))] as string[]);
      const companies = [...new Set(allEntries.map((d: any) => d.company_name).filter(Boolean))] as string[];
      setRegisteredCompanies(companies.sort());
    };
    fetchSiteNames();
  }, []);

  const fetchReports = async () => {
    let query = supabase
      .from("daily_reports")
      .select(`
        id,
        company_name,
        site_name,
        work_date,
        work_time,
        vehicles,
        workers,
        work_description,
        material_group_labels,
        created_at,
        user_id,
        status,
        daily_report_materials(
          id,
          quantity,
          group_index,
          inventory!item_id(type, maker, detail, unit)
        )
      `)
      .eq("status", "confirmed")
      .order("work_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (filterDate) {
      query = query.eq("work_date", filterDate);
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      return;
    }

    let filtered = (data || []) as unknown as Report[];

    // ユーザー名を一括取得
    const userIds = [...new Set(filtered.map((r) => r.user_id).filter(Boolean))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("users_profile")
        .select("id, name")
        .in("id", userIds);
      if (profiles) {
        const map: { [id: string]: string } = {};
        profiles.forEach((p: any) => { map[p.id] = p.name; });
        setUserNames(map);
      }
    }

    if (filterSite) {
      filtered = filtered.filter((r) =>
        r.site_name?.toLowerCase().includes(filterSite.toLowerCase())
      );
    }
    if (filterWorker) {
      filtered = filtered.filter((r) =>
        r.workers?.some((w) => w.toLowerCase().includes(filterWorker.toLowerCase()))
      );
    }

    setReports(filtered);
  };

  useEffect(() => {
    fetchReports();
  }, []);

  // --- 会社名編集 ---
  const handleSaveCompany = async (reportId: string) => {
    await supabase.from("daily_reports").update({ company_name: editingCompanyValue }).eq("id", reportId);
    setEditingCompanyId(null);
    setEditingCompanyValue("");
    fetchReports();
  };

  // --- Excel出力 ---

  const reportToRows = (report: Report, names: { [id: string]: string }) => {
    const rows: any[][] = [];
    rows.push(["会社名", report.company_name || ""]);
    rows.push(["現場名", report.site_name]);
    rows.push(["月日", report.work_date]);
    rows.push(["時間", report.work_time || ""]);
    rows.push(["登録者", names[report.user_id] || ""]);
    rows.push(["使用車両", (report.vehicles || []).filter(Boolean).join("、")]);
    rows.push(["作業員", (report.workers || []).filter(Boolean).join("、")]);
    rows.push(["作業内容", report.work_description || ""]);
    rows.push([]);

    // 部材
    const labels = report.material_group_labels || [];
    const mats = report.daily_report_materials || [];
    if (mats.length > 0) {
      const maxIdx = Math.max(...mats.map((m) => m.group_index ?? 0));
      for (let gi = 0; gi <= maxIdx; gi++) {
        const groupMats = mats.filter((m) => (m.group_index ?? 0) === gi);
        if (groupMats.length === 0) continue;
        const label = labels[gi] ? `${String.fromCharCode(0x2460 + gi)} ${labels[gi]}` : String.fromCharCode(0x2460 + gi);
        rows.push([label]);
        rows.push(["種類", "メーカー", "詳細", "数量", "単位"]);
        for (const m of groupMats) {
          rows.push([
            m.inventory?.type || "",
            m.inventory?.maker || "",
            m.inventory?.detail || "",
            m.quantity,
            m.inventory?.unit || "",
          ]);
        }
        rows.push([]);
      }
    } else {
      rows.push(["使用部材: なし"]);
    }
    return rows;
  };

  const downloadWorkbook = (wb: XLSX.WorkBook, filename: string) => {
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 1件の日報をExcel出力
  const exportSingleReport = (report: Report) => {
    const wb = XLSX.utils.book_new();
    const rows = reportToRows(report, userNames);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 10 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, report.work_date);
    downloadWorkbook(wb, `日報_${report.site_name}_${report.work_date}.xlsx`);
  };

  // 期間指定でExcel出力（日付ごとにタブ）
  const exportByDateRange = async () => {
    if (!exportDateFrom || !exportDateTo) {
      alert("期間を指定してください");
      return;
    }

    let query = supabase
      .from("daily_reports")
      .select(`*, daily_report_materials(id, quantity, group_index, inventory!item_id(type, maker, detail, unit))`)
      .eq("status", "confirmed")
      .gte("work_date", exportDateFrom)
      .lte("work_date", exportDateTo)
      .order("work_date")
      .order("created_at");

    if (exportSite.trim()) {
      query = query.ilike("site_name", `%${exportSite.trim()}%`);
    }

    const { data, error } = await query;
    if (error) { alert("取得に失敗しました"); return; }
    const results = (data || []) as unknown as Report[];
    if (results.length === 0) { alert("該当する日報がありません"); return; }

    // ユーザー名取得
    const uids = [...new Set(results.map((r) => r.user_id).filter(Boolean))];
    let names: { [id: string]: string } = { ...userNames };
    if (uids.length > 0) {
      const { data: profiles } = await supabase.from("users_profile").select("id, name").in("id", uids);
      if (profiles) profiles.forEach((p: any) => { names[p.id] = p.name; });
    }

    // 日付ごとにグループ化
    const byDate: Record<string, Report[]> = {};
    results.forEach((r) => {
      if (!byDate[r.work_date]) byDate[r.work_date] = [];
      byDate[r.work_date].push(r);
    });

    const wb = XLSX.utils.book_new();
    const sortedDates = Object.keys(byDate).sort();

    for (const date of sortedDates) {
      const dateReports = byDate[date];
      const allRows: any[][] = [];

      dateReports.forEach((report, idx) => {
        if (idx > 0) allRows.push([], ["─────────────────────────"]);
        allRows.push(...reportToRows(report, names));
      });

      const ws = XLSX.utils.aoa_to_sheet(allRows);
      ws["!cols"] = [{ wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 10 }, { wch: 8 }];
      // シート名は31文字以内（Excel制限）
      const sheetName = date.length > 31 ? date.slice(0, 31) : date;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    const siteLabel = exportSite.trim() ? `_${exportSite.trim()}` : "";
    downloadWorkbook(wb, `日報${siteLabel}_${exportDateFrom}～${exportDateTo}.xlsx`);
  };

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">日報ログ</h1>

      {/* 検索 */}
      <div className="flex gap-2 flex-wrap mb-4">
        <div className="relative">
          <input
            type="text"
            placeholder="現場名で検索"
            value={filterSite}
            onChange={(e) => { setFilterSite(e.target.value); setShowFilterSiteSuggest(true); }}
            onFocus={() => setShowFilterSiteSuggest(true)}
            onBlur={() => setTimeout(() => setShowFilterSiteSuggest(false), 150)}
            autoComplete="off"
            className="border rounded p-2 text-sm"
          />
          {showFilterSiteSuggest && filterSite.trim() && (() => {
            const suggestions = pastSiteNames.filter((s) =>
              s.toLowerCase().includes(filterSite.trim().toLowerCase())
            );
            return suggestions.length > 0 ? (
              <ul className="absolute z-10 bg-white border rounded shadow-lg w-60 max-h-40 overflow-y-auto mt-1">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      onMouseDown={() => { setFilterSite(s); setShowFilterSiteSuggest(false); }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null;
          })()}
        </div>
        <input
          type="text"
          placeholder="作業員名で検索"
          value={filterWorker}
          onChange={(e) => setFilterWorker(e.target.value)}
          className="border rounded p-2 text-sm"
        />
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="border rounded p-2 text-sm"
        />
        <button
          onClick={fetchReports}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm"
        >
          検索
        </button>
      </div>

      {/* Admin: Excel出力 */}
      {isAdmin && (
        <section className="bg-white border rounded-lg p-4 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-3">Excel出力（admin）</h2>
          <div className="flex gap-2 flex-wrap items-end">
            <div className="relative">
              <label className="text-xs text-gray-500 block mb-1">現場名（任意）</label>
              <input
                type="text"
                value={exportSite}
                onChange={(e) => { setExportSite(e.target.value); setShowExportSiteSuggest(true); }}
                onFocus={() => setShowExportSiteSuggest(true)}
                onBlur={() => setTimeout(() => setShowExportSiteSuggest(false), 150)}
                placeholder="空欄で全現場"
                autoComplete="off"
                className="border rounded p-2 text-sm w-40"
              />
              {showExportSiteSuggest && exportSite.trim() && (() => {
                const suggestions = pastSiteNames.filter((s) =>
                  s.toLowerCase().includes(exportSite.trim().toLowerCase())
                );
                return suggestions.length > 0 ? (
                  <ul className="absolute z-10 bg-white border rounded shadow-lg w-60 max-h-40 overflow-y-auto mt-1">
                    {suggestions.map((s) => (
                      <li key={s}>
                        <button
                          onMouseDown={() => { setExportSite(s); setShowExportSiteSuggest(false); }}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50"
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null;
              })()}
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">開始日</label>
              <input
                type="date"
                value={exportDateFrom}
                onChange={(e) => setExportDateFrom(e.target.value)}
                className="border rounded p-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">終了日</label>
              <input
                type="date"
                value={exportDateTo}
                onChange={(e) => setExportDateTo(e.target.value)}
                className="border rounded p-2 text-sm"
              />
            </div>
            <button
              onClick={exportByDateRange}
              className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded text-sm font-bold whitespace-nowrap"
            >
              Excel出力
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">日付ごとにシート（タブ）が分かれます。現場名を指定するとその現場のみ出力されます。</p>
        </section>
      )}

      {/* ログ一覧 */}
      {reports.length === 0 ? (
        <p className="text-gray-400 text-sm">日報がありません</p>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => {
            const isOpen = expandedId === report.id;
            return (
              <div key={report.id} className={`border rounded-lg bg-white overflow-hidden ${report.status === "draft" ? "border-yellow-300" : ""}`}>
                {/* ヘッダー行（クリックで展開） */}
                <div className="px-4 py-3 flex items-center gap-3">
                  {report.status === "draft" && (
                    <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap">下書き</span>
                  )}
                  <button
                    onClick={() => setExpandedId(isOpen ? null : report.id)}
                    className="flex-1 text-left flex items-center gap-3 hover:opacity-70 min-w-0"
                  >
                    <span className="text-sm font-semibold text-blue-700 whitespace-nowrap">
                      {report.work_date}
                    </span>
                    <span className="text-sm font-bold flex-1 truncate">
                      {report.site_name}
                    </span>
                    {report.work_time && (
                      <span className="text-xs text-gray-400 whitespace-nowrap">{report.work_time}</span>
                    )}
                    <span className="text-xs text-gray-400 whitespace-nowrap hidden sm:inline">
                      {report.workers?.filter(Boolean).join("・") || "—"}
                    </span>
                    <span className="text-gray-400 text-xs whitespace-nowrap">
                      {isOpen ? "▲" : "▼"}
                    </span>
                  </button>
                  {report.status === "draft" && (
                    <button
                      onClick={() => router.push(`/dashboard/report?draft=${report.id}`)}
                      className="bg-yellow-400 hover:bg-yellow-500 text-white text-xs px-3 py-1.5 rounded font-bold whitespace-nowrap"
                    >
                      続きを入力
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => exportSingleReport(report)}
                      className="bg-green-100 hover:bg-green-200 text-green-700 text-xs px-3 py-1.5 rounded font-bold whitespace-nowrap"
                    >
                      Excel
                    </button>
                  )}
                </div>

                {/* 展開内容 */}
                {isOpen && (
                  <div className="border-t px-4 py-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">

                    {/* 基本情報 */}
                    <div className="space-y-2">
                      <div>
                        <span className="text-xs text-gray-400 block">会社名</span>
                        {isAdmin && editingCompanyId === report.id ? (
                          <div className="flex gap-1 items-center mt-1">
                            <select
                              value={editingCompanyValue}
                              onChange={(e) => {
                                if (e.target.value === "__new__") {
                                  const name = prompt("新しい会社名を入力してください");
                                  if (name && name.trim()) {
                                    const trimmed = name.trim();
                                    const exact = registeredCompanies.find((c) => c === trimmed);
                                    if (exact) { setEditingCompanyValue(exact); }
                                    else {
                                      const similar = registeredCompanies.filter((c) =>
                                        c.toLowerCase().includes(trimmed.toLowerCase()) || trimmed.toLowerCase().includes(c.toLowerCase())
                                      );
                                      if (similar.length > 0) {
                                        if (!confirm(`類似の会社名があります:\n${similar.join("\n")}\n\nそのまま「${trimmed}」を新規登録しますか？`)) return;
                                      } else {
                                        if (!confirm(`「${trimmed}」を新しい会社名として登録しますか？`)) return;
                                      }
                                      setEditingCompanyValue(trimmed);
                                      setRegisteredCompanies((prev) => [...prev, trimmed].sort());
                                    }
                                  }
                                } else {
                                  setEditingCompanyValue(e.target.value);
                                }
                              }}
                              className="border rounded p-1 text-sm flex-1 min-w-0"
                            >
                              <option value="">選択してください</option>
                              {registeredCompanies.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                              <option value="__new__">＋ 新しい会社名を追加</option>
                            </select>
                            <button onClick={() => handleSaveCompany(report.id)}
                              className="text-blue-500 text-xs shrink-0">保存</button>
                            <button onClick={() => setEditingCompanyId(null)}
                              className="text-gray-400 text-xs shrink-0">取消</button>
                          </div>
                        ) : (
                          <span>
                            {report.company_name || "未登録"}
                            {isAdmin && (
                              <button
                                onClick={() => { setEditingCompanyId(report.id); setEditingCompanyValue(report.company_name || ""); }}
                                className="text-blue-500 text-xs ml-2"
                              >編集</button>
                            )}
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block">現場名</span>
                        <span className="font-semibold">{report.site_name}</span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block">月日</span>
                        <span>{report.work_date}</span>
                      </div>
                      {report.work_time && (
                        <div>
                          <span className="text-xs text-gray-400 block">時間</span>
                          <span>{report.work_time}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-xs text-gray-400 block">登録者</span>
                        <span>{userNames[report.user_id] || "—"}</span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block">登録日時</span>
                        <span className="text-xs text-gray-500">
                          {new Date(report.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                        </span>
                      </div>
                    </div>

                    {/* 車両・作業員 */}
                    <div className="space-y-2">
                      <div>
                        <span className="text-xs text-gray-400 block mb-1">使用車両</span>
                        {report.vehicles?.filter(Boolean).length > 0 ? (
                          <ul className="space-y-0.5">
                            {report.vehicles.filter(Boolean).map((v, i) => (
                              <li key={i} className="bg-gray-100 rounded px-2 py-0.5 inline-block mr-1 text-xs">{v}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block mb-1">作業員</span>
                        {report.workers?.filter(Boolean).length > 0 ? (
                          <ul className="space-y-0.5">
                            {report.workers.filter(Boolean).map((w, i) => (
                              <li key={i} className="bg-blue-50 rounded px-2 py-0.5 inline-block mr-1 text-xs">{w}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </div>
                    </div>

                    {/* 作業内容 */}
                    {report.work_description && (
                      <div className="md:col-span-2">
                        <span className="text-xs text-gray-400 block mb-1">作業内容</span>
                        <p className="text-sm whitespace-pre-wrap bg-gray-50 rounded px-3 py-2 border">
                          {report.work_description}
                        </p>
                      </div>
                    )}

                    {/* 使用部材（グループ別） */}
                    <div className="md:col-span-2">
                      <span className="text-xs text-gray-400 block mb-2">使用部材</span>
                      {report.daily_report_materials?.length > 0 ? (() => {
                        const labels = report.material_group_labels || [];
                        const maxIdx = Math.max(...report.daily_report_materials.map((m) => m.group_index ?? 0));
                        const groupIndices = Array.from({ length: maxIdx + 1 }, (_, i) => i);
                        return (
                          <div className="space-y-3">
                            {groupIndices.map((gi) => {
                              const mats = report.daily_report_materials.filter((m) => (m.group_index ?? 0) === gi);
                              if (mats.length === 0) return null;
                              return (
                                <div key={gi}>
                                  {(groupIndices.length > 1 || labels[gi]) && (
                                    <div className="text-xs font-semibold text-blue-700 mb-1">
                                      {String.fromCharCode(0x2460 + gi)}{labels[gi] ? `　${labels[gi]}` : ""}
                                    </div>
                                  )}
                                  <table className="table-auto border-collapse border text-xs w-full">
                                    <thead className="bg-gray-100">
                                      <tr>
                                        <th className="border px-3 py-1 text-left whitespace-nowrap">種類</th>
                                        <th className="border px-3 py-1 text-left whitespace-nowrap">メーカー</th>
                                        <th className="border px-3 py-1 text-left whitespace-nowrap">詳細</th>
                                        <th className="border px-3 py-1 text-center whitespace-nowrap">数量</th>
                                        <th className="border px-3 py-1 text-center whitespace-nowrap">単位</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {mats.map((m) => (
                                        <tr key={m.id} className="hover:bg-gray-50">
                                          <td className="border px-3 py-1 whitespace-nowrap">{m.inventory?.type || "—"}</td>
                                          <td className="border px-3 py-1 whitespace-nowrap">{m.inventory?.maker || "—"}</td>
                                          <td className="border px-3 py-1 whitespace-nowrap">{m.inventory?.detail || "—"}</td>
                                          <td className="border px-3 py-1 text-center font-bold">{m.quantity}</td>
                                          <td className="border px-3 py-1 text-center">{m.inventory?.unit || "—"}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })() : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </div>

                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

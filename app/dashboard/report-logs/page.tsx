"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

interface ReportMaterial {
  id: string;
  quantity: number;
  inventory: {
    type: string;
    maker: string;
    detail: string;
    unit: string;
  } | null;
}

interface Report {
  id: string;
  site_name: string;
  work_date: string;
  work_time: string | null;
  vehicles: string[];
  workers: string[];
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

  const fetchReports = async () => {
    let query = supabase
      .from("daily_reports")
      .select(`
        id,
        site_name,
        work_date,
        work_time,
        vehicles,
        workers,
        created_at,
        user_id,
        status,
        daily_report_materials(
          id,
          quantity,
          inventory!item_id(type, maker, detail, unit)
        )
      `)
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

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">日報ログ</h1>

      {/* 検索 */}
      <div className="flex gap-2 flex-wrap mb-4">
        <input
          type="text"
          placeholder="現場名で検索"
          value={filterSite}
          onChange={(e) => setFilterSite(e.target.value)}
          className="border rounded p-2 text-sm"
        />
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
                </div>

                {/* 展開内容 */}
                {isOpen && (
                  <div className="border-t px-4 py-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">

                    {/* 基本情報 */}
                    <div className="space-y-2">
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

                    {/* 使用部材 */}
                    <div className="md:col-span-2">
                      <span className="text-xs text-gray-400 block mb-2">使用部材</span>
                      {report.daily_report_materials?.length > 0 ? (
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
                            {report.daily_report_materials.map((m) => (
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
                      ) : (
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

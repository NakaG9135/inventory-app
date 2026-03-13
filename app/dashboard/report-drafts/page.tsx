"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

interface DraftMaterial {
  id: string;
  quantity: number;
  inventory: { type: string; maker: string; detail: string; unit: string } | null;
}

interface Draft {
  id: string;
  site_name: string;
  work_date: string;
  work_time: string | null;
  vehicles: string[];
  workers: string[];
  created_at: string;
  daily_report_materials: DraftMaterial[];
}

export default function ReportDraftsPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDrafts = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { setLoading(false); return; }

    const { data, error } = await supabase
      .from("daily_reports")
      .select(`
        id,
        site_name,
        work_date,
        work_time,
        vehicles,
        workers,
        created_at,
        daily_report_materials(
          id,
          quantity,
          inventory!item_id(type, maker, detail, unit)
        )
      `)
      .eq("status", "draft")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });

    if (error) { console.error(error); }
    else { setDrafts((data || []) as unknown as Draft[]); }
    setLoading(false);
  };

  const deleteDraft = async (id: string) => {
    if (!confirm("この下書きを削除しますか？")) return;
    await supabase.from("daily_report_materials").delete().eq("report_id", id);
    await supabase.from("daily_reports").delete().eq("id", id);
    setDrafts((d) => d.filter((r) => r.id !== id));
  };

  useEffect(() => {
    fetchDrafts();
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-1">一時保存した日報</h1>
      <p className="text-xs text-gray-400 mb-4">自分が保存した下書きのみ表示されます。在庫にはまだ反映されていません。</p>

      {loading ? (
        <p className="text-gray-400 text-sm">読み込み中...</p>
      ) : drafts.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">一時保存した日報はありません</p>
          <button
            onClick={() => router.push("/dashboard/report")}
            className="mt-4 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm"
          >
            日報を入力する
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((draft) => {
            const isOpen = expandedId === draft.id;
            return (
              <div key={draft.id} className="border border-yellow-300 rounded-lg bg-white overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-3">
                  <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap">下書き</span>
                  <button
                    onClick={() => setExpandedId(isOpen ? null : draft.id)}
                    className="flex-1 text-left flex items-center gap-3 hover:opacity-70 min-w-0"
                  >
                    <span className="text-sm font-semibold text-blue-700 whitespace-nowrap">{draft.work_date}</span>
                    <span className="text-sm font-bold flex-1 truncate">{draft.site_name}</span>
                    {draft.work_time && (
                      <span className="text-xs text-gray-400 whitespace-nowrap">{draft.work_time}</span>
                    )}
                    <span className="text-xs text-gray-400 whitespace-nowrap hidden sm:inline">
                      {draft.workers?.filter(Boolean).join("・") || "—"}
                    </span>
                    <span className="text-gray-400 text-xs whitespace-nowrap">{isOpen ? "▲" : "▼"}</span>
                  </button>
                  <button
                    onClick={() => router.push(`/dashboard/report?draft=${draft.id}`)}
                    className="bg-yellow-400 hover:bg-yellow-500 text-white text-xs px-3 py-1.5 rounded font-bold whitespace-nowrap"
                  >
                    続きを入力
                  </button>
                  <button
                    onClick={() => deleteDraft(draft.id)}
                    className="text-gray-300 hover:text-red-500 text-xs px-2 py-1.5 whitespace-nowrap"
                  >
                    削除
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t px-4 py-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="space-y-2">
                      <div><span className="text-xs text-gray-400 block">現場名</span><span className="font-semibold">{draft.site_name}</span></div>
                      <div><span className="text-xs text-gray-400 block">月日</span><span>{draft.work_date}</span></div>
                      {draft.work_time && (
                        <div><span className="text-xs text-gray-400 block">時間</span><span>{draft.work_time}</span></div>
                      )}
                      <div>
                        <span className="text-xs text-gray-400 block">保存日時</span>
                        <span className="text-xs text-gray-500">
                          {new Date(draft.created_at.endsWith("Z") || draft.created_at.includes("+") ? draft.created_at : draft.created_at + "Z").toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <span className="text-xs text-gray-400 block mb-1">使用車両</span>
                        {draft.vehicles?.filter(Boolean).length > 0 ? (
                          draft.vehicles.filter(Boolean).map((v, i) => (
                            <span key={i} className="bg-gray-100 rounded px-2 py-0.5 inline-block mr-1 text-xs">{v}</span>
                          ))
                        ) : <span className="text-gray-400 text-xs">—</span>}
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block mb-1">作業員</span>
                        {draft.workers?.filter(Boolean).length > 0 ? (
                          draft.workers.filter(Boolean).map((w, i) => (
                            <span key={i} className="bg-blue-50 rounded px-2 py-0.5 inline-block mr-1 text-xs">{w}</span>
                          ))
                        ) : <span className="text-gray-400 text-xs">—</span>}
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-xs text-gray-400 block mb-2">使用部材（未出庫）</span>
                      {draft.daily_report_materials?.length > 0 ? (
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
                            {draft.daily_report_materials.map((m) => (
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
                      ) : <span className="text-gray-400 text-xs">—</span>}
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

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

interface WorkerProfile {
  id: string;
  name: string;
  sites: string[];
}

export default function WorkersPage() {
  const router = useRouter();
  const [workers, setWorkers] = useState<WorkerProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data } = await supabase
        .from("users_profile")
        .select("role")
        .eq("id", user.id)
        .single();
      if (!data || data.role !== "admin") {
        router.push("/dashboard/inventory");
        return;
      }
      fetchWorkers();
    };
    checkAdmin();
  }, []);

  const fetchWorkers = async () => {
    setLoading(true);

    // role='user' の作業員一覧
    const { data: profiles, error } = await supabase
      .from("users_profile")
      .select("id, name")
      .eq("role", "user")
      .order("name");

    if (error || !profiles) { setLoading(false); return; }

    // 確定済み日報の現場名・作業員リストを一括取得
    const { data: reports } = await supabase
      .from("daily_reports")
      .select("site_name, workers")
      .eq("status", "confirmed");

    const reportList = (reports || []) as { site_name: string; workers: string[] }[];

    // 各作業員が登場した現場名を抽出
    const workersWithSites: WorkerProfile[] = profiles.map((p: { id: string; name: string }) => {
      const sites = [
        ...new Set(
          reportList
            .filter((r) => r.workers?.includes(p.name))
            .map((r) => r.site_name)
            .filter(Boolean)
        ),
      ].sort((a, b) => a.localeCompare(b, "ja"));
      return { id: p.id, name: p.name, sites };
    });

    setWorkers(workersWithSites);
    setLoading(false);
  };

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-bold mb-1">作業員名簿</h1>
      <p className="text-xs text-gray-400 mb-6">
        日報入力時の作業員選択に使用されます。経験現場は確定済み日報から抽出しています。
      </p>

      {loading ? (
        <p className="text-gray-400 text-sm">読み込み中...</p>
      ) : workers.length === 0 ? (
        <p className="text-gray-400 text-sm">作業員が登録されていません</p>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <ul className="divide-y">
            {workers.map((w) => (
              <li key={w.id} className="px-4 py-3">
                <div className="text-sm font-semibold mb-1">{w.name}</div>
                {w.sites.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {w.sites.map((site) => (
                      <span
                        key={site}
                        className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded"
                      >
                        {site}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-gray-300">現場経験なし</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

interface InventoryItem {
  id: string;
  type: string;
  maker: string;
  detail: string;
  unit: string;
  quantity: number;
}

interface MaterialRow {
  key: number;
  item: InventoryItem | null;
  quantity: number;
  search: string;
  showDropdown: boolean;
}

export default function ReportPage() {
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [pastSiteNames, setPastSiteNames] = useState<string[]>([]);

  // フォーム
  const [siteName, setSiteName] = useState("");
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [workTime, setWorkTime] = useState("");
  const [vehicles, setVehicles] = useState<string[]>([""]);
  const [workers, setWorkers] = useState<string[]>([""]);
  const [materials, setMaterials] = useState<MaterialRow[]>([
    { key: 0, item: null, quantity: 0, search: "", showDropdown: false },
  ]);
  const [keyCounter, setKeyCounter] = useState(1);

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const fetchInventory = async () => {
      const { data } = await supabase.from("inventory").select("*").order("type");
      if (data) setInventoryItems(data as InventoryItem[]);
    };
    const fetchSites = async () => {
      const { data } = await supabase
        .from("inventory_logs")
        .select("site_name")
        .not("site_name", "is", null);
      if (data) {
        const unique = [...new Set(data.map((d: any) => d.site_name).filter(Boolean))] as string[];
        setPastSiteNames(unique);
      }
    };
    fetchInventory();
    fetchSites();
  }, []);

  // 車両
  const addVehicle = () => setVehicles((v) => [...v, ""]);
  const removeVehicle = (i: number) => setVehicles((v) => v.filter((_, idx) => idx !== i));
  const updateVehicle = (i: number, val: string) =>
    setVehicles((v) => v.map((x, idx) => (idx === i ? val : x)));

  // 作業員
  const addWorker = () => setWorkers((w) => [...w, ""]);
  const removeWorker = (i: number) => setWorkers((w) => w.filter((_, idx) => idx !== i));
  const updateWorker = (i: number, val: string) =>
    setWorkers((w) => w.map((x, idx) => (idx === i ? val : x)));

  // 部材行
  const addMaterial = () => {
    setMaterials((m) => [
      ...m,
      { key: keyCounter, item: null, quantity: 0, search: "", showDropdown: false },
    ]);
    setKeyCounter((k) => k + 1);
  };
  const removeMaterial = (key: number) =>
    setMaterials((m) => m.filter((r) => r.key !== key));
  const updateMaterial = (key: number, patch: Partial<MaterialRow>) =>
    setMaterials((m) => m.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const filteredItems = (search: string) => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return inventoryItems.filter(
      (i) =>
        i.type?.toLowerCase().includes(q) ||
        i.maker?.toLowerCase().includes(q) ||
        i.detail?.toLowerCase().includes(q)
    );
  };

  const handleSubmit = async () => {
    if (!siteName.trim()) { alert("現場名を入力してください"); return; }
    if (!workDate) { alert("月日を入力してください"); return; }
    const validMaterials = materials.filter((r) => r.item && r.quantity > 0);
    if (validMaterials.length === 0) { alert("部材を1行以上入力してください"); return; }

    setSubmitting(true);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) { alert("ログインしてください"); setSubmitting(false); return; }

    // 1. 日報登録
    const { data: report, error: reportError } = await supabase
      .from("daily_reports")
      .insert({
        site_name: siteName.trim(),
        work_date: workDate,
        work_time: workTime || null,
        vehicles: vehicles.filter((v) => v.trim()),
        workers: workers.filter((w) => w.trim()),
        user_id: userData.user.id,
      })
      .select()
      .single();

    if (reportError || !report) {
      console.error(reportError);
      alert("日報の保存に失敗しました: " + reportError?.message);
      setSubmitting(false);
      return;
    }

    // 2. 各部材を出庫処理
    for (const row of validMaterials) {
      const item = row.item!;

      // 在庫更新
      const newQty = item.quantity - row.quantity;
      await supabase
        .from("inventory")
        .update({ quantity: newQty })
        .eq("id", item.id);

      // 日報部材登録
      await supabase.from("daily_report_materials").insert({
        report_id: report.id,
        item_id: item.id,
        quantity: row.quantity,
      });

      // 出庫ログ（1部材1行）
      await supabase.from("inventory_logs").insert({
        item_id: item.id,
        change_type: "out",
        quantity: row.quantity,
        user_id: userData.user.id,
        site_name: siteName.trim(),
      });
    }

    setSubmitting(false);
    setDone(true);
  };

  const reset = () => {
    setSiteName("");
    setWorkDate(new Date().toISOString().slice(0, 10));
    setWorkTime("");
    setVehicles([""]);
    setWorkers([""]);
    setMaterials([{ key: 0, item: null, quantity: 0, search: "", showDropdown: false }]);
    setKeyCounter(1);
    setDone(false);
  };

  if (done) {
    return (
      <div className="p-6 max-w-xl">
        <div className="bg-green-50 border border-green-300 rounded-lg p-6 text-center">
          <div className="text-3xl mb-3">✓</div>
          <h2 className="text-lg font-bold text-green-700 mb-2">日報を登録しました</h2>
          <p className="text-sm text-gray-600 mb-4">部材の出庫処理も完了しました。</p>
          <button
            onClick={reset}
            className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded"
          >
            続けて入力
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold mb-6">日報入力</h1>

      {/* 基本情報 */}
      <section className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-500 mb-3">基本情報</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-gray-500 block mb-1">現場名 *</label>
            <input
              type="text"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              list="site-datalist"
              placeholder="現場名を入力"
              className="border rounded p-2 w-full text-sm"
            />
            <datalist id="site-datalist">
              {pastSiteNames.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">月日 *</label>
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              className="border rounded p-2 w-full text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">時間</label>
            <input
              type="text"
              value={workTime}
              onChange={(e) => setWorkTime(e.target.value)}
              placeholder="例：9:00〜17:00"
              className="border rounded p-2 w-full text-sm"
            />
          </div>
        </div>
      </section>

      {/* 使用車両 */}
      <section className="bg-white border rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500">使用車両</h2>
          <button
            onClick={addVehicle}
            className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded"
          >
            ＋ 追加
          </button>
        </div>
        <div className="space-y-2">
          {vehicles.map((v, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                type="text"
                value={v}
                onChange={(e) => updateVehicle(i, e.target.value)}
                placeholder={`車両 ${i + 1}`}
                className="border rounded p-2 flex-1 text-sm"
              />
              {vehicles.length > 1 && (
                <button
                  onClick={() => removeVehicle(i)}
                  className="text-gray-400 hover:text-red-500 text-lg leading-none"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 作業員 */}
      <section className="bg-white border rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500">作業員</h2>
          <button
            onClick={addWorker}
            className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded"
          >
            ＋ 追加
          </button>
        </div>
        <div className="space-y-2">
          {workers.map((w, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                type="text"
                value={w}
                onChange={(e) => updateWorker(i, e.target.value)}
                placeholder={`作業員 ${i + 1}`}
                className="border rounded p-2 flex-1 text-sm"
              />
              {workers.length > 1 && (
                <button
                  onClick={() => removeWorker(i)}
                  className="text-gray-400 hover:text-red-500 text-lg leading-none"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 使用部材 */}
      <section className="bg-white border rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500">使用部材</h2>
          <button
            onClick={addMaterial}
            className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded"
          >
            ＋ 追加
          </button>
        </div>

        <div className="space-y-3">
          {materials.map((row) => (
            <div key={row.key} className="border rounded p-3 relative">
              {/* 商品検索 */}
              <div className="mb-2 relative">
                <label className="text-xs text-gray-400 block mb-1">商品検索（種類・メーカー・詳細）</label>
                <input
                  type="text"
                  value={row.search}
                  onChange={(e) =>
                    updateMaterial(row.key, { search: e.target.value, showDropdown: true, item: null })
                  }
                  onFocus={() => updateMaterial(row.key, { showDropdown: true })}
                  onBlur={() => setTimeout(() => updateMaterial(row.key, { showDropdown: false }), 150)}
                  placeholder="種類・詳細で検索..."
                  className="border rounded p-2 w-full text-sm"
                />
                {row.showDropdown && filteredItems(row.search).length > 0 && (
                  <ul className="absolute z-10 bg-white border rounded shadow-lg w-full max-h-40 overflow-y-auto mt-1">
                    {filteredItems(row.search).map((item) => (
                      <li key={item.id}>
                        <button
                          onMouseDown={() =>
                            updateMaterial(row.key, {
                              item,
                              search: `${item.type}　${item.maker}　${item.detail}`,
                              showDropdown: false,
                            })
                          }
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                        >
                          <span className="font-medium">{item.detail}</span>
                          <span className="text-xs text-gray-400 ml-2">（{item.type} / {item.maker}）</span>
                          <span className="text-xs text-gray-400 ml-1">在庫: {item.quantity}{item.unit}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 選択済み表示 + 数量 */}
              {row.item && (
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 flex-1">
                    {row.item.type}　{row.item.maker}　{row.item.detail}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-400">{row.item.unit}</span>
                    <input
                      type="number"
                      min="1"
                      max={row.item.quantity}
                      value={row.quantity || ""}
                      onChange={(e) =>
                        updateMaterial(row.key, { quantity: Math.max(0, Number(e.target.value)) })
                      }
                      placeholder="数量"
                      className="border rounded p-1 w-20 text-center text-sm"
                    />
                  </div>
                </div>
              )}

              {/* 削除ボタン */}
              {materials.length > 1 && (
                <button
                  onClick={() => removeMaterial(row.key)}
                  className="absolute top-2 right-2 text-gray-300 hover:text-red-500 text-lg leading-none"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 送信 */}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-lg font-bold text-sm disabled:opacity-50"
      >
        {submitting ? "登録中..." : "日報を登録（部材を出庫）"}
      </button>
    </div>
  );
}

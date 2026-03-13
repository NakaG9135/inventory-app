"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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

interface MaterialGroup {
  groupKey: number;
  label: string;
  materials: MaterialRow[];
  matKeyCounter: number;
}

const emptyMat = (): MaterialRow => ({ key: 0, item: null, quantity: 0, search: "", showDropdown: false });
const emptyGroup = (groupKey: number): MaterialGroup => ({
  groupKey,
  label: "",
  materials: [emptyMat()],
  matKeyCounter: 1,
});

function ReportForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const draftId = searchParams.get("draft");

  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [pastSiteNames, setPastSiteNames] = useState<string[]>([]);
  const [rosterWorkers, setRosterWorkers] = useState<string[]>([]);

  const [siteName, setSiteName] = useState("");
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [workTimeStart, setWorkTimeStart] = useState("");
  const [workTimeEnd, setWorkTimeEnd] = useState("");
  const [vehicles, setVehicles] = useState<string[]>([""]);
  const [workers, setWorkers] = useState<string[]>([]);
  const [customWorker, setCustomWorker] = useState("");
  const [workDescription, setWorkDescription] = useState("");
  const [groups, setGroups] = useState<MaterialGroup[]>([emptyGroup(0)]);
  const [groupKeyCounter, setGroupKeyCounter] = useState(1);

  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [doneType, setDoneType] = useState<"draft" | "confirmed">("confirmed");

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
    const fetchRosterWorkers = async () => {
      const { data } = await supabase
        .from("users_profile")
        .select("name")
        .eq("role", "user")
        .order("name");
      if (data) setRosterWorkers(data.map((d: any) => d.name));
    };
    fetchInventory();
    fetchSites();
    fetchRosterWorkers();
  }, []);

  // 下書き読み込み
  useEffect(() => {
    if (!draftId) return;
    const loadDraft = async () => {
      const { data } = await supabase
        .from("daily_reports")
        .select(`*, daily_report_materials(*, inventory!item_id(*))`)
        .eq("id", draftId)
        .eq("status", "draft")
        .single();
      if (!data) return;
      setSiteName(data.site_name || "");
      setWorkDate(data.work_date || new Date().toISOString().slice(0, 10));
      const parts = (data.work_time || "").split("～");
      setWorkTimeStart(parts[0] || "");
      setWorkTimeEnd(parts[1] || "");
      setVehicles(data.vehicles?.length ? data.vehicles : [""]);
      setWorkers(data.workers?.length ? data.workers : []);
      setWorkDescription(data.work_description || "");

      const matsData: any[] = data.daily_report_materials || [];
      const groupLabels: string[] = data.material_group_labels || [];
      const maxIdx = matsData.length > 0
        ? Math.max(...matsData.map((m: any) => m.group_index ?? 0))
        : 0;
      const total = Math.max(maxIdx, groupLabels.length - 1);
      const loadedGroups: MaterialGroup[] = [];
      for (let gi = 0; gi <= total; gi++) {
        const mats = matsData
          .filter((m: any) => (m.group_index ?? 0) === gi)
          .map((m: any, i: number) => ({
            key: i,
            item: m.inventory as InventoryItem,
            quantity: m.quantity,
            search: m.inventory ? `${m.inventory.type}　${m.inventory.maker}　${m.inventory.detail}` : "",
            showDropdown: false,
          }));
        loadedGroups.push({
          groupKey: gi,
          label: groupLabels[gi] || "",
          materials: mats.length ? mats : [emptyMat()],
          matKeyCounter: mats.length,
        });
      }
      const result = loadedGroups.length ? loadedGroups : [emptyGroup(0)];
      setGroups(result);
      setGroupKeyCounter(result.length);
    };
    loadDraft();
  }, [draftId]);

  // 車両
  const addVehicle = () => setVehicles((v) => [...v, ""]);
  const removeVehicle = (i: number) => setVehicles((v) => v.filter((_, idx) => idx !== i));
  const updateVehicle = (i: number, val: string) =>
    setVehicles((v) => v.map((x, idx) => (idx === i ? val : x)));

  // 作業員
  const toggleWorker = (name: string) =>
    setWorkers((w) => w.includes(name) ? w.filter((x) => x !== name) : [...w, name]);
  const addCustomWorker = () => {
    const name = customWorker.trim();
    if (!name) return;
    if (!workers.includes(name)) setWorkers((w) => [...w, name]);
    setCustomWorker("");
  };
  const removeWorker = (name: string) => setWorkers((w) => w.filter((x) => x !== name));

  // グループ操作
  const addGroup = () => {
    setGroups((g) => [...g, emptyGroup(groupKeyCounter)]);
    setGroupKeyCounter((k) => k + 1);
  };
  const removeGroup = (groupKey: number) =>
    setGroups((g) => g.filter((x) => x.groupKey !== groupKey));
  const updateGroupLabel = (groupKey: number, label: string) =>
    setGroups((g) => g.map((x) => x.groupKey === groupKey ? { ...x, label } : x));

  // グループ内部材操作
  const addMatToGroup = (groupKey: number) =>
    setGroups((g) => g.map((x) => x.groupKey !== groupKey ? x : {
      ...x,
      materials: [...x.materials, { key: x.matKeyCounter, item: null, quantity: 0, search: "", showDropdown: false }],
      matKeyCounter: x.matKeyCounter + 1,
    }));
  const removeMatFromGroup = (groupKey: number, matKey: number) =>
    setGroups((g) => g.map((x) => x.groupKey !== groupKey ? x : {
      ...x, materials: x.materials.filter((m) => m.key !== matKey),
    }));
  const updateMatInGroup = (groupKey: number, matKey: number, patch: Partial<MaterialRow>) =>
    setGroups((g) => g.map((x) => x.groupKey !== groupKey ? x : {
      ...x, materials: x.materials.map((m) => m.key === matKey ? { ...m, ...patch } : m),
    }));

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

  const buildReportPayload = () => ({
    site_name: siteName.trim(),
    work_date: workDate,
    work_time: workTimeStart || workTimeEnd ? `${workTimeStart}～${workTimeEnd}` : null,
    vehicles: vehicles.filter((v) => v.trim()),
    workers: workers.filter((w) => w.trim()),
    work_description: workDescription.trim() || null,
    material_group_labels: groups.map((g) => g.label),
  });

  const saveMaterials = async (reportId: string) => {
    await supabase.from("daily_report_materials").delete().eq("report_id", reportId);
    for (const [gi, group] of groups.entries()) {
      const valid = group.materials.filter((m) => m.item && m.quantity > 0);
      for (const row of valid) {
        await supabase.from("daily_report_materials").insert({
          report_id: reportId,
          item_id: row.item!.id,
          quantity: row.quantity,
          group_index: gi,
        });
      }
    }
  };

  // 一時保存（在庫処理なし）
  const handleSaveDraft = async () => {
    if (!siteName.trim()) { alert("現場名を入力してください"); return; }
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { alert("ログインしてください"); setSaving(false); return; }

    let reportId = draftId;
    if (draftId) {
      const { error } = await supabase.from("daily_reports").update(buildReportPayload()).eq("id", draftId);
      if (error) { alert("保存に失敗しました: " + error.message); setSaving(false); return; }
    } else {
      const { data: report, error } = await supabase.from("daily_reports").insert({
        ...buildReportPayload(),
        user_id: session.user.id,
        status: "draft",
      }).select().single();
      if (error || !report) { alert("保存に失敗しました: " + error?.message); setSaving(false); return; }
      reportId = report.id;
    }
    await saveMaterials(reportId!);
    setSaving(false);
    setDoneType("draft");
    setDone(true);
  };

  // 本登録（在庫出庫処理あり）
  const handleSubmit = async () => {
    if (!siteName.trim()) { alert("現場名を入力してください"); return; }
    if (!workDate) { alert("月日を入力してください"); return; }
    const allValid = groups.flatMap((g) => g.materials.filter((m) => m.item && m.quantity > 0));
    if (allValid.length === 0) { alert("部材を1行以上入力してください"); return; }
    setSubmitting(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { alert("ログインしてください"); setSubmitting(false); return; }

    let reportId = draftId;
    if (draftId) {
      const { error } = await supabase.from("daily_reports").update({
        ...buildReportPayload(),
        status: "confirmed",
      }).eq("id", draftId);
      if (error) { alert("登録に失敗しました: " + error.message); setSubmitting(false); return; }
      await supabase.from("daily_report_materials").delete().eq("report_id", draftId);
    } else {
      const { data: report, error } = await supabase.from("daily_reports").insert({
        ...buildReportPayload(),
        user_id: session.user.id,
        status: "confirmed",
      }).select().single();
      if (error || !report) { alert("登録に失敗しました: " + error?.message); setSubmitting(false); return; }
      reportId = report.id;
    }

    // 部材登録 + 在庫出庫処理
    for (const [gi, group] of groups.entries()) {
      for (const row of group.materials.filter((m) => m.item && m.quantity > 0)) {
        const item = row.item!;
        const { data: latest } = await supabase.from("inventory").select("quantity").eq("id", item.id).single();
        if (latest) {
          await supabase.from("inventory").update({ quantity: latest.quantity - row.quantity }).eq("id", item.id);
        }
        await supabase.from("daily_report_materials").insert({
          report_id: reportId,
          item_id: item.id,
          quantity: row.quantity,
          group_index: gi,
        });
        await supabase.from("inventory_logs").insert({
          item_id: item.id,
          change_type: "out",
          quantity: row.quantity,
          user_id: session.user.id,
          site_name: siteName.trim(),
        });
      }
    }

    setSubmitting(false);
    setDoneType("confirmed");
    setDone(true);
  };

  const reset = () => {
    setSiteName("");
    setWorkDate(new Date().toISOString().slice(0, 10));
    setWorkTimeStart("");
    setWorkTimeEnd("");
    setVehicles([""]);
    setWorkers([]);
    setCustomWorker("");
    setWorkDescription("");
    setGroups([emptyGroup(0)]);
    setGroupKeyCounter(1);
    setDone(false);
    router.push("/dashboard/report");
  };

  if (done) {
    return (
      <div className="p-6 max-w-xl">
        <div className={`border rounded-lg p-6 text-center ${doneType === "draft" ? "bg-yellow-50 border-yellow-300" : "bg-green-50 border-green-300"}`}>
          <div className="text-3xl mb-3">{doneType === "draft" ? "📋" : "✓"}</div>
          <h2 className={`text-lg font-bold mb-2 ${doneType === "draft" ? "text-yellow-700" : "text-green-700"}`}>
            {doneType === "draft" ? "一時保存しました" : "日報を登録しました"}
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            {doneType === "draft"
              ? "一時保存した日報から続きを入力・登録できます。在庫の出庫はまだ行われていません。"
              : "部材の出庫処理も完了しました。"}
          </p>
          <div className="flex gap-2 justify-center">
            <button onClick={() => router.push("/dashboard/report-logs")}
              className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm">
              日報ログへ
            </button>
            <button onClick={reset}
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm">
              続けて入力
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-xl font-bold">{draftId ? "日報（下書き編集）" : "日報入力"}</h1>
        {draftId && (
          <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-1 rounded font-medium">下書き</span>
        )}
      </div>

      {/* 基本情報 */}
      <section className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-500 mb-3">基本情報</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-gray-500 block mb-1">現場名 *</label>
            <input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)}
              list="site-datalist" placeholder="現場名を入力"
              className="border rounded p-2 w-full text-sm" />
            <datalist id="site-datalist">
              {pastSiteNames.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">月日 *</label>
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)}
              className="border rounded p-2 w-full text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">時間</label>
            <div className="flex items-center gap-1">
              <input type="time" value={workTimeStart} onChange={(e) => setWorkTimeStart(e.target.value)}
                className="border rounded p-2 text-sm flex-1" />
              <span className="text-gray-500 text-sm">～</span>
              <input type="time" value={workTimeEnd} onChange={(e) => setWorkTimeEnd(e.target.value)}
                className="border rounded p-2 text-sm flex-1" />
            </div>
          </div>
        </div>
      </section>

      {/* 使用車両 */}
      <section className="bg-white border rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500">使用車両</h2>
          <button onClick={addVehicle} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">＋ 追加</button>
        </div>
        <div className="space-y-2">
          {vehicles.map((v, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input type="text" value={v} onChange={(e) => updateVehicle(i, e.target.value)}
                placeholder={`車両 ${i + 1}`} className="border rounded p-2 flex-1 text-sm" />
              {vehicles.length > 1 && (
                <button onClick={() => removeVehicle(i)} className="text-gray-400 hover:text-red-500 text-lg leading-none">×</button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 作業員 */}
      <section className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-500 mb-3">作業員</h2>
        {rosterWorkers.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-gray-400 mb-2">名簿から選択</p>
            <div className="flex flex-wrap gap-2">
              {rosterWorkers.map((name) => (
                <label key={name} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={workers.includes(name)}
                    onChange={() => toggleWorker(name)} className="accent-blue-500" />
                  <span className="text-sm">{name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {workers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {workers.map((name) => (
              <span key={name} className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5 text-xs">
                {name}
                <button onClick={() => removeWorker(name)} className="text-blue-300 hover:text-red-500 leading-none ml-0.5">×</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input type="text" value={customWorker}
            onChange={(e) => setCustomWorker(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustomWorker()}
            placeholder="名簿にない場合は直接入力"
            className="border rounded p-2 flex-1 text-sm" />
          <button onClick={addCustomWorker} disabled={!customWorker.trim()}
            className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded disabled:opacity-40">
            追加
          </button>
        </div>
      </section>

      {/* 使用部材（グループ別） */}
      <section className="bg-white border rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-500">使用部材</h2>
          <button onClick={addGroup}
            className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 px-3 py-1 rounded">
            ＋ 工区を追加
          </button>
        </div>

        <div className="space-y-4">
          {groups.map((group, gi) => (
            <div key={group.groupKey} className="border rounded-lg p-3 bg-gray-50">
              {/* グループヘッダー */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base font-bold text-blue-600 w-6 shrink-0">
                  {String.fromCharCode(0x2460 + gi)}
                </span>
                <input
                  type="text"
                  value={group.label}
                  onChange={(e) => updateGroupLabel(group.groupKey, e.target.value)}
                  placeholder="工区・場所名（任意）"
                  className="border rounded p-1.5 flex-1 text-sm bg-white"
                />
                {groups.length > 1 && (
                  <button onClick={() => removeGroup(group.groupKey)}
                    className="text-gray-300 hover:text-red-500 text-lg leading-none px-1">×</button>
                )}
              </div>

              {/* グループ内部材 */}
              <div className="space-y-2">
                {group.materials.map((row) => (
                  <div key={row.key} className="border rounded p-3 bg-white relative">
                    <div className="mb-2 relative">
                      <label className="text-xs text-gray-400 block mb-1">商品検索（種類・メーカー・詳細）</label>
                      <input
                        type="text"
                        value={row.search}
                        onChange={(e) => updateMatInGroup(group.groupKey, row.key, { search: e.target.value, showDropdown: true, item: null })}
                        onFocus={() => updateMatInGroup(group.groupKey, row.key, { showDropdown: true })}
                        onBlur={() => setTimeout(() => updateMatInGroup(group.groupKey, row.key, { showDropdown: false }), 150)}
                        placeholder="種類・詳細で検索..."
                        className="border rounded p-2 w-full text-sm"
                      />
                      {row.showDropdown && filteredItems(row.search).length > 0 && (
                        <ul className="absolute z-10 bg-white border rounded shadow-lg w-full max-h-40 overflow-y-auto mt-1">
                          {filteredItems(row.search).map((item) => (
                            <li key={item.id}>
                              <button
                                onMouseDown={() => updateMatInGroup(group.groupKey, row.key, {
                                  item,
                                  search: `${item.type}　${item.maker}　${item.detail}`,
                                  showDropdown: false,
                                })}
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
                    {row.item && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 flex-1">
                          {row.item.type}　{row.item.maker}　{row.item.detail}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-400">{row.item.unit}</span>
                          <input type="number" min="1" value={row.quantity || ""}
                            onChange={(e) => updateMatInGroup(group.groupKey, row.key, { quantity: Math.max(0, Number(e.target.value)) })}
                            placeholder="数量" className="border rounded p-1 w-20 text-center text-sm" />
                        </div>
                      </div>
                    )}
                    {group.materials.length > 1 && (
                      <button onClick={() => removeMatFromGroup(group.groupKey, row.key)}
                        className="absolute top-2 right-2 text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                    )}
                  </div>
                ))}
              </div>

              <button onClick={() => addMatToGroup(group.groupKey)}
                className="mt-2 w-full text-xs bg-white hover:bg-gray-100 border px-3 py-1.5 rounded text-gray-500">
                ＋ 部材を追加
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 作業内容 */}
      <section className="bg-white border rounded-lg p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-500 mb-3">作業内容</h2>
        <textarea
          value={workDescription}
          onChange={(e) => setWorkDescription(e.target.value)}
          placeholder="作業内容、通達事項等を入力してください"
          rows={5}
          className="border rounded p-2 w-full text-sm resize-y"
        />
      </section>

      {/* ボタン */}
      <div className="flex gap-3">
        <button onClick={handleSaveDraft} disabled={saving || submitting}
          className="flex-1 bg-yellow-400 hover:bg-yellow-500 text-white py-3 rounded-lg font-bold text-sm disabled:opacity-50">
          {saving ? "保存中..." : "一時保存"}
        </button>
        <button onClick={handleSubmit} disabled={submitting || saving}
          className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-lg font-bold text-sm disabled:opacity-50">
          {submitting ? "登録中..." : "登録（出庫）"}
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-2 text-center">
        一時保存は在庫に反映されません。登録（出庫）で在庫から出庫されます。
      </p>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense>
      <ReportForm />
    </Suspense>
  );
}

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
  note: string;
}

interface MaterialGroup {
  groupKey: number;
  label: string;
  materials: MaterialRow[];
  matKeyCounter: number;
}

const emptyMat = (): MaterialRow => ({ key: 0, item: null, quantity: 0, search: "", showDropdown: false, note: "" });
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
  const [siteCompanyMap, setSiteCompanyMap] = useState<Record<string, string>>({});
  const [rosterWorkers, setRosterWorkers] = useState<string[]>([]);
  const [registeredVehicles, setRegisteredVehicles] = useState<string[]>([]);

  const [companyName, setCompanyName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [workTimeStart, setWorkTimeStart] = useState("");
  const [workTimeEnd, setWorkTimeEnd] = useState("");
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [customVehicle, setCustomVehicle] = useState("");
  const [workers, setWorkers] = useState<string[]>([]);
  const [customWorker, setCustomWorker] = useState("");
  const [workDescription, setWorkDescription] = useState("");
  const [groups, setGroups] = useState<MaterialGroup[]>([emptyGroup(0)]);

  // 新規部材登録
  const [newItemModal, setNewItemModal] = useState<{ groupKey: number; matKey: number; search: string } | null>(null);
  const [newlyRegisteredIds, setNewlyRegisteredIds] = useState<Set<string>>(new Set());
  const [newItemType, setNewItemType] = useState("");
  const [newItemMaker, setNewItemMaker] = useState("");
  const [newItemDetail, setNewItemDetail] = useState("");
  const [newItemUnit, setNewItemUnit] = useState("");
  const [groupKeyCounter, setGroupKeyCounter] = useState(1);

  const [showSiteSuggest, setShowSiteSuggest] = useState(false);
  const [registeredCompanies, setRegisteredCompanies] = useState<string[]>([]);

  // 新規現場登録
  const [siteManagerModal, setSiteManagerModal] = useState(false);
  const [siteManagerName, setSiteManagerName] = useState("");
  const [allWorkers, setAllWorkers] = useState<string[]>([]);
  const [pendingSubmitType, setPendingSubmitType] = useState<"draft" | "confirmed" | null>(null);

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
      const [logs, reports, reserves] = await Promise.all([
        supabase.from("inventory_logs").select("site_name, company_name").not("site_name", "is", null),
        supabase.from("daily_reports").select("site_name, company_name").not("site_name", "is", null),
        supabase.from("material_reserve_sites").select("site_name, company_name"),
      ]);
      const allEntries = [
        ...(logs.data || []),
        ...(reports.data || []),
        ...(reserves.data || []),
      ].filter((d: any) => d.site_name);
      const names = [...new Set(allEntries.map((d: any) => d.site_name))] as string[];
      setPastSiteNames(names);
      const map: Record<string, string> = {};
      allEntries.forEach((d: any) => {
        if (d.site_name && d.company_name) map[d.site_name] = d.company_name;
      });
      setSiteCompanyMap(map);
      setRegisteredCompanies([...new Set(Object.values(map))].filter(Boolean).sort());
    };
    const fetchRosterWorkers = async () => {
      const { data } = await supabase
        .from("users_profile")
        .select("name")
        .eq("role", "user")
        .order("name");
      if (data) setRosterWorkers(data.map((d: any) => d.name));
    };
    const fetchVehicles = async () => {
      const { data } = await supabase.from("vehicles").select("number").order("created_at");
      if (data) setRegisteredVehicles(data.map((d: any) => d.number));
    };
    const fetchAllWorkers = async () => {
      const { data } = await supabase.from("users_profile").select("name").order("name");
      if (data) setAllWorkers(data.map((d: any) => d.name));
    };
    fetchInventory();
    fetchSites();
    fetchRosterWorkers();
    fetchVehicles();
    fetchAllWorkers();
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
      setCompanyName(data.company_name || "");
      setSiteName(data.site_name || "");
      setWorkDate(data.work_date || new Date().toISOString().slice(0, 10));
      const parts = (data.work_time || "").split("～");
      setWorkTimeStart(parts[0] || "");
      setWorkTimeEnd(parts[1] || "");
      setVehicles(data.vehicles?.length ? data.vehicles : []);
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
            note: m.note || "",
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
  const toggleVehicle = (number: string) =>
    setVehicles((v) => v.includes(number) ? v.filter((x) => x !== number) : [...v, number]);
  const addCustomVehicle = () => {
    const name = customVehicle.trim();
    if (!name) return;
    if (!vehicles.includes(name)) setVehicles((v) => [...v, name]);
    setCustomVehicle("");
  };
  const removeVehicle = (name: string) => setVehicles((v) => v.filter((x) => x !== name));

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
      materials: [...x.materials, { key: x.matKeyCounter, item: null, quantity: 0, search: "", showDropdown: false, note: "" }],
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

  const openNewItemModal = (groupKey: number, matKey: number, search: string) => {
    setNewItemType("");
    setNewItemMaker("");
    setNewItemDetail(search);
    setNewItemUnit("");
    setNewItemModal({ groupKey, matKey, search });
  };

  const handleRegisterNewItem = async () => {
    if (!newItemType.trim() || !newItemDetail.trim() || !newItemUnit.trim()) {
      alert("種類、詳細、単位は必須です");
      return;
    }
    // 類似チェック
    const q = newItemDetail.trim().toLowerCase();
    const similar = inventoryItems.filter(
      (i) => i.detail?.toLowerCase().includes(q) || i.type?.toLowerCase().includes(newItemType.trim().toLowerCase())
    );
    if (similar.length > 0) {
      const list = similar.slice(0, 5).map((i) => `${i.type} / ${i.maker} / ${i.detail}`).join("\n");
      if (!confirm(`類似の商品があります:\n${list}\n\nそのまま新規登録しますか？`)) return;
    }

    const { data, error } = await supabase.from("inventory").insert({
      type: newItemType.trim(),
      maker: newItemMaker.trim(),
      detail: newItemDetail.trim(),
      unit: newItemUnit.trim(),
      quantity: 0,
    }).select().single();

    if (error || !data) {
      alert("登録に失敗しました: " + (error?.message || ""));
      return;
    }

    const newItem: InventoryItem = data;
    setInventoryItems((prev) => [...prev, newItem]);
    setNewlyRegisteredIds((prev) => new Set(prev).add(newItem.id));

    if (newItemModal) {
      updateMatInGroup(newItemModal.groupKey, newItemModal.matKey, {
        item: newItem,
        search: `${newItem.type}　${newItem.maker}　${newItem.detail}`,
        showDropdown: false,
      });
    }

    setNewItemModal(null);
    alert("在庫一覧に新規登録しました");
  };

  const buildReportPayload = () => ({
    company_name: companyName.trim(),
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
          note: row.note || "",
        });
      }
    }
  };

  // 一時保存（在庫処理なし）
  const handleSaveDraft = async () => {
    const siteOk = await checkAndRegisterSite("draft");
    if (!siteOk) return;
    doSaveDraft();
  };

  const doSaveDraft = async () => {
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

  // 現場リスト照合
  const checkAndRegisterSite = async (type: "draft" | "confirmed"): Promise<boolean> => {
    const name = siteName.trim();
    if (!name) return true;

    const { data: existing } = await supabase
      .from("material_reserve_sites")
      .select("id, company_name")
      .eq("site_name", name)
      .single();

    if (!existing) {
      // 新規現場 → 管理者選択モーダル
      setPendingSubmitType(type);
      setSiteManagerName("");
      setSiteManagerModal(true);
      return false; // 処理を中断し、モーダルのcallbackで再開
    }

    // 既存現場に会社名がなければ追記（既に別の会社名がある場合は上書きしない）
    if (companyName.trim() && (!existing.company_name || existing.company_name === companyName.trim())) {
      await supabase.from("material_reserve_sites")
        .update({ company_name: companyName.trim() })
        .eq("id", existing.id);
    }
    return true;
  };

  const handleSiteManagerConfirm = async () => {
    if (!siteManagerName.trim()) {
      alert("管理者を選択してください");
      return;
    }
    await supabase.from("material_reserve_sites").insert({
      company_name: companyName.trim(),
      site_name: siteName.trim(),
      manager_name: siteManagerName.trim(),
    });
    setSiteManagerModal(false);

    if (pendingSubmitType === "confirmed") {
      doSubmit();
    } else if (pendingSubmitType === "draft") {
      doSaveDraft();
    }
    setPendingSubmitType(null);
  };

  // 本登録（在庫出庫処理あり）
  const handleSubmit = async () => {
    const noMaterialKeywords = ["なし", "無し", "無"];
    const firstGroupLabel = groups[0]?.label.trim() || "";
    const firstGroupIsNashi = noMaterialKeywords.some((k) => firstGroupLabel.includes(k));

    const errors: string[] = [];
    if (!companyName.trim()) errors.push("会社名");
    if (!siteName.trim()) errors.push("現場名");
    if (!workDate) errors.push("月日");
    if (!workTimeStart) errors.push("開始時間");
    if (!workTimeEnd) errors.push("終了時間");
    if (vehicles.filter(Boolean).length === 0) errors.push("使用車両（1台以上）");
    if (workers.filter(Boolean).length === 0) errors.push("作業員（1名以上）");
    if (!firstGroupLabel) errors.push("使用部材①の工区・場所名（ない場合は「なし」と入力）");
    for (let i = 1; i < groups.length; i++) {
      if (!groups[i].label.trim()) errors.push(`使用部材${String.fromCharCode(0x2460 + i)}の工区・場所名`);
    }
    if (!firstGroupIsNashi) {
      for (const group of groups) {
        const hasValidMat = group.materials.some((m) => m.item && m.quantity > 0);
        if (!hasValidMat) {
          const lbl = group.label.trim() || "（ラベル未入力）";
          errors.push(`「${lbl}」の商品を1つ以上選択してください`);
        }
      }
    }
    if (!workDescription.trim()) errors.push("作業内容");

    if (errors.length > 0) {
      alert(`以下の項目を入力してください:\n・${errors.join("\n・")}`);
      return;
    }

    // 新規登録された商品の確認
    const allValid = groups.flatMap((g) => g.materials.filter((m) => m.item && m.quantity > 0));
    const newItems = allValid.filter((m) => m.item && m.item.quantity === 0);
    if (newItems.length > 0) {
      const list = newItems.map((m) => `${m.item!.type} / ${m.item!.detail}`).join("\n");
      if (!confirm(`以下の商品は在庫一覧に新規登録されたものです:\n${list}\n\nこのまま登録しますか？`)) return;
    }

    // 現場リスト照合
    const siteOk = await checkAndRegisterSite("confirmed");
    if (!siteOk) return;

    doSubmit();
  };

  const doSubmit = async () => {
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

    // 材料確保から現場名で検索
    const { data: reserveSite } = await supabase
      .from("material_reserve_sites")
      .select("id")
      .eq("site_name", siteName.trim())
      .single();

    // 盛替キーワード
    const morikaeKeywords = ["盛替", "盛替え", "盛変え", "盛変", "盛換え", "盛換"];
    const isMorikae = (note: string) => morikaeKeywords.some((k) => note.includes(k));

    // 部材登録 + 在庫出庫処理
    for (const [gi, group] of groups.entries()) {
      for (const row of group.materials.filter((m) => m.item && m.quantity > 0)) {
        const item = row.item!;
        const skipDeduction = isMorikae(row.note || "");
        let remainingQty = row.quantity;

        // 材料確保から引く（盛替の場合はスキップ）
        if (reserveSite && !skipDeduction) {
          const { data: reserveItem } = await supabase
            .from("material_reserve_items")
            .select("id, quantity")
            .eq("site_id", reserveSite.id)
            .eq("item_id", item.id)
            .single();

          if (reserveItem) {
            const deductFromReserve = Math.min(reserveItem.quantity, remainingQty);
            const newReserveQty = reserveItem.quantity - deductFromReserve;

            if (newReserveQty <= 0) {
              await supabase.from("material_reserve_items").delete().eq("id", reserveItem.id);
            } else {
              await supabase.from("material_reserve_items")
                .update({ quantity: newReserveQty, updated_at: new Date().toISOString() })
                .eq("id", reserveItem.id);
            }

            remainingQty -= deductFromReserve;
          }
        }

        // 確保で足りない分のみ在庫から追加で引く（確保分は確保時に既に引かれている）
        // 新規登録された商品・盛替の場合は在庫から引かない
        if (remainingQty > 0 && !newlyRegisteredIds.has(item.id) && !skipDeduction) {
          const { data: latest } = await supabase.from("inventory").select("quantity").eq("id", item.id).single();
          if (latest) {
            await supabase.from("inventory").update({ quantity: latest.quantity - remainingQty }).eq("id", item.id);
          }
        }

        await supabase.from("daily_report_materials").insert({
          report_id: reportId,
          item_id: item.id,
          quantity: row.quantity,
          group_index: gi,
          note: row.note || "",
        });

        // 出庫ログは全量分残す
        await supabase.from("inventory_logs").insert({
          item_id: item.id,
          change_type: "out",
          quantity: row.quantity,
          user_id: session.user.id,
          company_name: companyName.trim(),
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
    setVehicles([]);
    setCustomVehicle("");
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">会社名</label>
            <select value={companyName}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  const name = prompt("新しい会社名を入力してください");
                  if (name && name.trim()) {
                    const trimmed = name.trim();
                    const exact = registeredCompanies.find((c) => c === trimmed);
                    if (exact) { setCompanyName(exact); }
                    else {
                      const similar = registeredCompanies.filter((c) =>
                        c.toLowerCase().includes(trimmed.toLowerCase()) || trimmed.toLowerCase().includes(c.toLowerCase())
                      );
                      if (similar.length > 0) {
                        if (!confirm(`類似の会社名があります:\n${similar.join("\n")}\n\nそのまま「${trimmed}」を新規登録しますか？`)) return;
                      } else {
                        if (!confirm(`「${trimmed}」を新しい会社名として登録しますか？`)) return;
                      }
                      setCompanyName(trimmed);
                      setRegisteredCompanies((prev) => [...prev, trimmed].sort());
                    }
                  }
                } else {
                  setCompanyName(e.target.value);
                }
              }}
              className="border rounded p-2 w-full">
              <option value="">選択してください</option>
              {registeredCompanies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="__new__">＋ 新しい会社名を追加</option>
            </select>
          </div>
          <div className="relative">
            <label className="text-xs text-gray-500 block mb-1">現場名 *</label>
            <input type="text" value={siteName}
              onChange={(e) => {
                const val = e.target.value;
                setSiteName(val);
                setShowSiteSuggest(true);
                // 完全一致の場合、会社名を自動入力
                if (siteCompanyMap[val] && !companyName.trim()) {
                  setCompanyName(siteCompanyMap[val]);
                }
              }}
              onFocus={() => setShowSiteSuggest(true)}
              onBlur={() => {
                setTimeout(() => setShowSiteSuggest(false), 150);
                // blur時にも完全一致チェック
                if (siteCompanyMap[siteName.trim()] && !companyName.trim()) {
                  setCompanyName(siteCompanyMap[siteName.trim()]);
                }
              }}
              placeholder="現場名を入力" autoComplete="off"
              className="border rounded p-2 w-full" />
            {showSiteSuggest && siteName.trim() && (() => {
              const suggestions = pastSiteNames.filter((s) => {
                const matchName = s.toLowerCase().includes(siteName.trim().toLowerCase());
                if (companyName.trim()) {
                  const co = siteCompanyMap[s] || "";
                  return matchName && co.toLowerCase().includes(companyName.trim().toLowerCase());
                }
                return matchName;
              });
              return suggestions.length > 0 ? (
                <ul className="absolute z-10 bg-white border rounded shadow-lg w-full max-h-40 overflow-y-auto mt-1">
                  {suggestions.map((s) => (
                    <li key={s}>
                      <button
                        onMouseDown={() => {
                          setSiteName(s);
                          if (siteCompanyMap[s]) setCompanyName(siteCompanyMap[s]);
                          setShowSiteSuggest(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                      >
                        {s}
                        {siteCompanyMap[s] && <span className="text-xs text-gray-400 ml-2">({siteCompanyMap[s]})</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null;
            })()}
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">月日 *</label>
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)}
              className="border rounded p-2 w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">時間 *</label>
            <div className="flex items-center gap-2">
              <input type="time" value={workTimeStart} onChange={(e) => setWorkTimeStart(e.target.value)}
                className="border rounded p-2 flex-1 min-w-0" />
              <span className="text-gray-500 shrink-0">～</span>
              <input type="time" value={workTimeEnd} onChange={(e) => setWorkTimeEnd(e.target.value)}
                className="border rounded p-2 flex-1 min-w-0" />
            </div>
          </div>
        </div>
      </section>

      {/* 使用車両 */}
      <section className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-500 mb-3">使用車両</h2>
        {registeredVehicles.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {registeredVehicles.map((number) => (
              <label key={number} className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={vehicles.includes(number)}
                  onChange={() => toggleVehicle(number)} className="accent-blue-500" />
                <span>{number}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">車両が登録されていません。管理者に車両の登録を依頼してください。</p>
        )}
        {vehicles.filter(Boolean).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {vehicles.filter(Boolean).map((v) => (
              <span key={v} className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5 text-xs">
                {v}
                <button onClick={() => removeVehicle(v)} className="text-blue-300 hover:text-red-500 leading-none ml-0.5">×</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2 min-w-0 mt-3">
          <input type="text" value={customVehicle}
            onChange={(e) => setCustomVehicle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustomVehicle()}
            placeholder="リース車両等を直接入力"
            className="border rounded p-2 flex-1 min-w-0" />
          <button onClick={addCustomVehicle} disabled={!customVehicle.trim()}
            className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded disabled:opacity-40 shrink-0">
            追加
          </button>
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
        <div className="flex gap-2 min-w-0">
          <input type="text" value={customWorker}
            onChange={(e) => setCustomWorker(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustomWorker()}
            placeholder="名簿にない場合は直接入力"
            className="border rounded p-2 flex-1 min-w-0" />
          <button onClick={addCustomWorker} disabled={!customWorker.trim()}
            className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded disabled:opacity-40 shrink-0">
            追加
          </button>
        </div>
      </section>

      {/* 使用部材（グループ別） */}
      <section className="bg-white border rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-500">使用部材</h2>
          <button onClick={addGroup}
            className="bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 px-4 py-2 rounded font-semibold whitespace-nowrap shrink-0">
            ＋ 項目を追加
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
                  placeholder="工区・場所名（必須 ない場合「なし」と記入）"
                  className="border rounded p-2 flex-1 min-w-0 bg-white"
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
                        className="border rounded p-2 w-full"
                      />
                      {row.showDropdown && row.search.trim() && (() => {
                        const results = filteredItems(row.search);
                        return (
                          <ul className="absolute z-10 bg-white border rounded shadow-lg w-full max-h-40 overflow-y-auto mt-1">
                            {results.map((item) => (
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
                            {results.length === 0 && (
                              <li>
                                <button
                                  onMouseDown={() => openNewItemModal(group.groupKey, row.key, row.search)}
                                  className="w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 font-bold"
                                >
                                  「{row.search}」を在庫に新規登録する
                                </button>
                              </li>
                            )}
                          </ul>
                        );
                      })()}
                    </div>
                    {row.item && (
                      <>
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 flex-1">
                            {row.item.type}　{row.item.maker}　{row.item.detail}
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-gray-400">{row.item.unit}</span>
                            <input type="number" min="1" value={row.quantity || ""}
                              onChange={(e) => updateMatInGroup(group.groupKey, row.key, { quantity: Math.max(0, Number(e.target.value)) })}
                              placeholder="数量" className="border rounded p-2 w-24 text-center" />
                          </div>
                        </div>
                        <div className="mt-1">
                          <input type="text" value={row.note}
                            onChange={(e) => updateMatInGroup(group.groupKey, row.key, { note: e.target.value })}
                            placeholder="備考（任意）"
                            className="border rounded p-1.5 w-full text-xs text-gray-600" />
                        </div>
                      </>
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

      {/* 新規部材登録モーダル */}
      {newItemModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-sm font-bold mb-1">在庫一覧に新規登録</h3>
            <p className="text-xs text-gray-500 mb-4">在庫一覧にない商品を登録します。日報の登録時に在庫から出庫されます。</p>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">種類 *</label>
                <input type="text" value={newItemType}
                  onChange={(e) => setNewItemType(e.target.value)}
                  placeholder="例: 塗料、配管、金具"
                  className="border rounded p-2 w-full text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">メーカー</label>
                <input type="text" value={newItemMaker}
                  onChange={(e) => setNewItemMaker(e.target.value)}
                  placeholder="メーカー名（任意）"
                  className="border rounded p-2 w-full text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">詳細 *</label>
                <input type="text" value={newItemDetail}
                  onChange={(e) => setNewItemDetail(e.target.value)}
                  placeholder="商品名・サイズなど"
                  className="border rounded p-2 w-full text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">単位 *</label>
                <input type="text" value={newItemUnit}
                  onChange={(e) => setNewItemUnit(e.target.value)}
                  placeholder="例: 本、個、m、kg"
                  className="border rounded p-2 w-full text-sm" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleRegisterNewItem}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded text-sm font-bold">
                登録
              </button>
              <button onClick={() => setNewItemModal(null)}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 py-2 rounded text-sm">
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新規現場 管理者選択モーダル */}
      {siteManagerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-sm font-bold mb-1">新規現場の登録</h3>
            <p className="text-xs text-gray-500 mb-4">「{siteName.trim()}」は現場リストに未登録です。管理者を選択して登録してください。</p>
            <div className="mb-4">
              <label className="text-xs text-gray-500 block mb-1">管理者 *</label>
              <select
                value={siteManagerName}
                onChange={(e) => setSiteManagerName(e.target.value)}
                className="border rounded p-2 w-full text-sm"
              >
                <option value="">選択してください</option>
                {allWorkers.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSiteManagerConfirm}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded text-sm font-bold">
                登録して続行
              </button>
              <button onClick={() => { setSiteManagerModal(false); setPendingSubmitType(null); }}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 py-2 rounded text-sm">
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
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

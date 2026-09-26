"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { usePermissions } from "@/components/PermissionsProvider";
import { LEVEL_OPERATE, LEVEL_VIEW } from "@/lib/permissions";
import EmployeeSubTable, { type FieldDef } from "@/components/EmployeeSubTable";
import {
  DEPARTMENTS,
  MARITAL_STATUSES,
  ageFrom,
  fmtDate,
  fmtDateTime,
  fmtYen,
  serviceLength,
  type Employee,
} from "@/lib/employees";

type AccessLog = {
  id: number; created_at: string; event: string; ip: string; user_agent: string; device_type: string;
  os: string; os_version: string; browser: string; browser_version: string; device_model: string;
  is_installed: boolean | null; extra: Record<string, unknown> | null;
};
type LocationLog = { id: number; created_at: string; status: string; latitude: number | null; longitude: number | null; accuracy: number | null };

const TABS = [
  ["basic", "基本情報"],
  ["family", "家族"],
  ["contacts", "緊急連絡先"],
  ["vehicles", "自家用車"],
  ["quals", "免許・資格"],
  ["payments", "慶弔金"],
  ["leaves", "休暇"],
  ["access", "接続ログ"],
  ["location", "位置情報"],
] as const;
type TabKey = (typeof TABS)[number][0];

const opts = (list: string[]) => list.map((v) => ({ value: v, label: v || "—" }));

const LOCATION_STATUS: Record<string, string> = {
  ok: "取得",
  denied: "許可されていない",
  timeout: "時間切れ",
  unavailable: "取得できず",
  unsupported: "端末が非対応",
};

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = usePermissions();
  const canView = can("employees", LEVEL_VIEW);
  const canEdit = can("employees", LEVEL_OPERATE);
  const [tab, setTab] = useState<TabKey>("basic");
  const [emp, setEmp] = useState<Employee | null>(null);
  const [form, setForm] = useState<Employee | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [accessLogs, setAccessLogs] = useState<AccessLog[] | null>(null);
  const [locationLogs, setLocationLogs] = useState<LocationLog[] | null>(null);
  const [childrenAges, setChildrenAges] = useState<number[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("employees").select("*").eq("id", id).maybeSingle();
    if (error || !data) {
      setNotFound(true);
      return;
    }
    setEmp(data as Employee);
    setForm(data as Employee);
  }, [id]);

  const loadChildren = useCallback(async () => {
    const { data } = await supabase.from("employee_children").select("birth_date").eq("employee_id", id);
    setChildrenAges(((data ?? []) as { birth_date: string | null }[]).map((c) => ageFrom(c.birth_date)).filter((a): a is number => a !== null));
  }, [id]);

  useEffect(() => {
    if (canView) {
      load();
      loadChildren();
    }
  }, [canView, load, loadChildren]);

  useEffect(() => {
    if (!emp?.user_id) return;
    if (tab === "access" && accessLogs === null) {
      supabase.from("access_logs").select("*").eq("user_id", emp.user_id).order("created_at", { ascending: false }).limit(1000)
        .then(({ data }) => setAccessLogs((data ?? []) as AccessLog[]));
    }
    if (tab === "location" && locationLogs === null) {
      supabase.from("location_logs").select("*").eq("user_id", emp.user_id).order("created_at", { ascending: false }).limit(1000)
        .then(({ data }) => setLocationLogs((data ?? []) as LocationLog[]));
    }
  }, [tab, emp?.user_id, accessLogs, locationLogs]);

  const saveBasic = async () => {
    if (!form) return;
    setSaving(true);
    setMessage(null);
    const { id: _id, user_id: _u, created_at: _c, updated_at: _up, ...rest } = form;
    const payload = {
      ...rest,
      birth_date: rest.birth_date || null,
      hire_date: rest.hire_date || null,
      leave_date: rest.leave_date || null,
    };
    const { error } = await supabase.from("employees").update(payload).eq("id", id);
    setSaving(false);
    if (error) {
      setMessage(`保存に失敗しました: ${error.message}`);
      return;
    }
    setMessage("保存しました");
    load();
  };

  const removeEmployee = async () => {
    if (!emp) return;
    if (!confirm(`${emp.name} を名簿から削除しますか？\n家族・資格・休暇などの登録内容もすべて削除されます。\n（退職の場合は、削除せずに「退職日」を入れることをおすすめします）`)) return;
    const { error } = await supabase.from("employees").delete().eq("id", id);
    if (error) {
      alert(`削除に失敗しました: ${error.message}`);
      return;
    }
    router.push("/dashboard/employees");
  };

  if (!canView) return null;
  if (notFound) return <p>従業員が見つかりません。<Link href="/dashboard/employees" className="text-blue-600 underline">一覧へ戻る</Link></p>;
  if (!emp || !form) return <p>読み込み中...</p>;

  const set = (patch: Partial<Employee>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const inputCls = "border rounded p-2 text-sm w-full bg-white disabled:bg-gray-50";
  const age = ageFrom(emp.birth_date);

  const field = (label: string, key: keyof Employee, type: "text" | "date" | "tel" | "email" = "text") => (
    <div>
      <label className="text-xs text-gray-600 block mb-1">{label}</label>
      <input type={type} value={(form[key] as string | null) ?? ""} onChange={(e) => set({ [key]: e.target.value } as Partial<Employee>)} disabled={!canEdit} className={inputCls} />
    </div>
  );
  const select = (label: string, key: keyof Employee, list: string[]) => (
    <div>
      <label className="text-xs text-gray-600 block mb-1">{label}</label>
      <select value={(form[key] as string) ?? ""} onChange={(e) => set({ [key]: e.target.value } as Partial<Employee>)} disabled={!canEdit} className={inputCls}>
        {Array.from(new Set([...(list), (form[key] as string) ?? ""])).map((v) => <option key={v} value={v}>{v || "—"}</option>)}
      </select>
    </div>
  );

  const qualFields: FieldDef[] = [
    { key: "kind", label: "種類", type: "select", options: opts(["資格", "免許"]) },
    { key: "name", label: "名称", type: "text", placeholder: "例：第二種電気工事士、普通自動車免許" },
    { key: "number", label: "番号", type: "text" },
    { key: "acquired_date", label: "取得日", type: "date" },
    { key: "expiry_date", label: "有効期限", type: "date" },
    { key: "paid_by", label: "費用負担", type: "select", options: [{ value: "", label: "—" }, { value: "company", label: "会社負担" }, { value: "personal", label: "個人負担" }] },
    { key: "cost", label: "費用（円）", type: "number" },
    { key: "notes", label: "備考", type: "textarea" },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/dashboard/employees" className="text-sm text-blue-600 hover:underline">← 従業員名簿</Link>

      <div className="flex flex-wrap items-end justify-between gap-2 mt-2 mb-4">
        <div>
          <h1 className="text-2xl font-bold">{emp.name || "（名前未設定）"}</h1>
          <p className="text-sm text-gray-600">
            {[emp.department, emp.position].filter(Boolean).join(" ")}
            {age !== null && `　${age}歳`}
            {emp.hire_date && `　勤続 ${serviceLength(emp.hire_date, emp.leave_date)}`}
            {emp.leave_date && <span className="text-red-600">　{fmtDate(emp.leave_date)} 退職</span>}
          </p>
        </div>
        {!emp.user_id && <span className="text-xs text-gray-400">アカウントなし（接続ログ・位置情報はありません）</span>}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b mb-4">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === key ? "border-blue-600 text-blue-700 font-medium" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        {tab === "basic" && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {field("名前", "name")}
              {field("ふりがな", "name_kana")}
              {select("部署", "department", DEPARTMENTS)}
              {field("役職", "position")}
              {field("雇用形態", "employment_type")}
              {select("性別", "gender", ["", "男性", "女性", "その他"])}
              <div>
                {field("生年月日", "birth_date", "date")}
                {ageFrom(form.birth_date) !== null && <p className="text-xs text-gray-500 mt-1">{ageFrom(form.birth_date)}歳</p>}
              </div>
              {field("電話番号", "phone", "tel")}
              {field("メールアドレス", "email", "email")}
              <div>
                {field("入社年月日", "hire_date", "date")}
                {form.hire_date && <p className="text-xs text-gray-500 mt-1">勤続 {serviceLength(form.hire_date, form.leave_date)}</p>}
              </div>
              {field("退職日", "leave_date", "date")}
              {select("婚姻", "marital_status", MARITAL_STATUSES)}
              {field("配偶者の名前", "spouse_name")}
              <div className="sm:col-span-2 lg:col-span-3">{field("現住所", "current_address")}</div>
              <div className="sm:col-span-2 lg:col-span-3">{field("実家の住所", "family_address")}</div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="text-xs text-gray-600 block mb-1">特記事項</label>
                <textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} disabled={!canEdit} rows={4} className={inputCls} />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              子供：{childrenAges.length}人{childrenAges.length > 0 && `（${childrenAges.sort((a, b) => b - a).map((a) => `${a}歳`).join("・")}）`}　※「家族」タブで登録
            </p>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-3 mt-4">
                <button onClick={saveBasic} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded text-sm disabled:opacity-50">
                  {saving ? "保存中…" : "保存"}
                </button>
                {message && <span className={`text-sm ${message.startsWith("保存しました") ? "text-green-700" : "text-red-600"}`}>{message}</span>}
                <button onClick={removeEmployee} className="ml-auto text-xs text-red-500 hover:underline">名簿から削除</button>
              </div>
            )}
          </>
        )}

        {tab === "family" && (
          <>
            <p className="text-sm mb-3">
              婚姻：{emp.marital_status || "—"}
              {emp.spouse_name && `（配偶者：${emp.spouse_name}）`}
              <span className="text-xs text-gray-400 ml-2">※婚姻・配偶者は「基本情報」で変更</span>
            </p>
            <h3 className="font-bold text-sm mb-2">子供</h3>
            <EmployeeSubTable
              table="employee_children"
              employeeId={id}
              canEdit={canEdit}
              orderBy={{ column: "birth_date", ascending: true }}
              addLabel="子供を追加"
              fields={[
                { key: "name", label: "名前", type: "text" },
                { key: "birth_date", label: "生年月日", type: "date" },
                { key: "notes", label: "備考", type: "textarea" },
              ]}
              summary={(rows) => {
                const ages = rows.map((r) => ageFrom(r.birth_date as string | null)).filter((a): a is number => a !== null);
                return <p className="text-sm text-gray-600">{rows.length}人{ages.length > 0 && `（${ages.map((a) => `${a}歳`).join("・")}）`}</p>;
              }}
              render={(r) => (
                <>
                  <span className="font-medium">{(r.name as string) || "（名前未入力）"}</span>
                  {r.birth_date ? <span className="text-gray-600">　{fmtDate(r.birth_date as string)}生（{ageFrom(r.birth_date as string)}歳）</span> : null}
                  {r.notes ? <p className="text-xs text-gray-500 mt-1">{r.notes as string}</p> : null}
                </>
              )}
            />
          </>
        )}

        {tab === "contacts" && (
          <EmployeeSubTable
            table="employee_emergency_contacts"
            employeeId={id}
            canEdit={canEdit}
            orderBy={{ column: "created_at", ascending: true }}
            addLabel="緊急連絡先を追加"
            fields={[
              { key: "name", label: "名前", type: "text" },
              { key: "relationship", label: "続柄", type: "text", placeholder: "例：妻、父" },
              { key: "phone", label: "電話番号", type: "text" },
              { key: "address", label: "住所", type: "text" },
              { key: "notes", label: "備考", type: "textarea" },
            ]}
            render={(r) => (
              <>
                <span className="font-medium">{r.name as string}</span>
                {r.relationship ? <span className="text-gray-600">（{r.relationship as string}）</span> : null}
                {r.phone ? <a href={`tel:${r.phone as string}`} className="ml-2 text-blue-600">{r.phone as string}</a> : null}
                {r.address ? <p className="text-xs text-gray-600 mt-1">{r.address as string}</p> : null}
                {r.notes ? <p className="text-xs text-gray-500 mt-1">{r.notes as string}</p> : null}
              </>
            )}
          />
        )}

        {tab === "vehicles" && (
          <EmployeeSubTable
            table="employee_vehicles"
            employeeId={id}
            canEdit={canEdit}
            orderBy={{ column: "created_at", ascending: true }}
            addLabel="車両を追加"
            fields={[
              { key: "maker", label: "メーカー", type: "text" },
              { key: "model", label: "車種", type: "text" },
              { key: "plate_number", label: "ナンバー", type: "text" },
              { key: "color", label: "色", type: "text" },
              { key: "inspection_expiry", label: "車検満了日", type: "date" },
              { key: "insurance_expiry", label: "任意保険の満期日", type: "date" },
              { key: "notes", label: "備考", type: "textarea" },
            ]}
            render={(r) => (
              <>
                <span className="font-medium">{[r.maker, r.model].filter(Boolean).join(" ") || "（車種未入力）"}</span>
                {r.plate_number ? <span className="ml-2">{r.plate_number as string}</span> : null}
                {r.color ? <span className="text-gray-600">（{r.color as string}）</span> : null}
                <p className="text-xs text-gray-600 mt-1">
                  {r.inspection_expiry ? `車検 ${fmtDate(r.inspection_expiry as string)}　` : ""}
                  {r.insurance_expiry ? `保険 ${fmtDate(r.insurance_expiry as string)}` : ""}
                </p>
                {r.notes ? <p className="text-xs text-gray-500 mt-1">{r.notes as string}</p> : null}
              </>
            )}
          />
        )}

        {tab === "quals" && (
          <EmployeeSubTable
            table="employee_qualifications"
            employeeId={id}
            canEdit={canEdit}
            orderBy={{ column: "acquired_date", ascending: true }}
            addLabel="免許・資格を追加"
            fields={qualFields}
            summary={(rows) => {
              const company = rows.filter((r) => r.paid_by === "company");
              const total = company.reduce((s, r) => s + (Number(r.cost) || 0), 0);
              return <p className="text-sm text-gray-600">{rows.length}件（会社負担 {company.length}件・{fmtYen(total)}）</p>;
            }}
            render={(r) => {
              const expired = r.expiry_date && (r.expiry_date as string) < new Date().toISOString().slice(0, 10);
              return (
                <>
                  <span className="text-xs bg-gray-100 rounded px-1.5 py-0.5 mr-2">{r.kind as string}</span>
                  <span className="font-medium">{r.name as string}</span>
                  {r.number ? <span className="text-gray-500 text-xs ml-2">No.{r.number as string}</span> : null}
                  <p className="text-xs text-gray-600 mt-1">
                    {r.acquired_date ? `取得 ${fmtDate(r.acquired_date as string)}　` : ""}
                    {r.expiry_date ? <span className={expired ? "text-red-600 font-bold" : ""}>有効期限 {fmtDate(r.expiry_date as string)}{expired ? "（期限切れ）" : ""}　</span> : null}
                    {r.paid_by === "company" ? "会社負担" : r.paid_by === "personal" ? "個人負担" : ""}
                    {r.cost !== null && r.cost !== undefined ? `　${fmtYen(r.cost as number)}` : ""}
                  </p>
                  {r.notes ? <p className="text-xs text-gray-500 mt-1">{r.notes as string}</p> : null}
                </>
              );
            }}
          />
        )}

        {tab === "payments" && (
          <EmployeeSubTable
            table="employee_payments"
            employeeId={id}
            canEdit={canEdit}
            orderBy={{ column: "paid_date", ascending: false }}
            addLabel="慶弔金を追加"
            fields={[
              { key: "kind", label: "種類", type: "select", options: opts(["結婚祝い", "出産祝い", "忌引き（香典）", "見舞金", "その他"]) },
              { key: "paid_date", label: "支払日", type: "date" },
              { key: "amount", label: "金額（円）", type: "number" },
              { key: "notes", label: "備考", type: "textarea", placeholder: "例：父 逝去" },
            ]}
            summary={(rows) => <p className="text-sm text-gray-600">合計 {fmtYen(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0))}（{rows.length}件）</p>}
            render={(r) => (
              <>
                <span className="font-medium">{r.kind as string}</span>
                <span className="ml-2">{fmtYen(r.amount as number)}</span>
                {r.paid_date ? <span className="text-gray-600 text-xs ml-2">{fmtDate(r.paid_date as string)}</span> : null}
                {r.notes ? <p className="text-xs text-gray-500 mt-1">{r.notes as string}</p> : null}
              </>
            )}
          />
        )}

        {tab === "leaves" && (
          <EmployeeSubTable
            table="employee_leaves"
            employeeId={id}
            canEdit={canEdit}
            orderBy={{ column: "start_date", ascending: false }}
            addLabel="休暇を追加"
            fields={[
              { key: "leave_type", label: "種類", type: "select", options: opts(["有給休暇", "特別休暇", "慶弔休暇", "代休", "欠勤", "その他"]) },
              { key: "start_date", label: "開始日", type: "date" },
              { key: "end_date", label: "終了日", type: "date" },
              { key: "days", label: "日数（半日は0.5）", type: "number" },
              { key: "notes", label: "備考", type: "textarea" },
            ]}
            summary={(rows) => {
              const byYear: Record<string, Record<string, number>> = {};
              for (const r of rows) {
                const y = ((r.start_date as string) ?? "").slice(0, 4) || "日付なし";
                const t = (r.leave_type as string) || "その他";
                byYear[y] ??= {};
                byYear[y][t] = (byYear[y][t] ?? 0) + (Number(r.days) || 0);
              }
              return (
                <div className="text-sm text-gray-600 space-y-0.5">
                  {Object.entries(byYear).sort(([a], [b]) => b.localeCompare(a)).map(([y, types]) => (
                    <p key={y}>{y}年：{Object.entries(types).map(([t, d]) => `${t} ${d}日`).join("・")}</p>
                  ))}
                </div>
              );
            }}
            render={(r) => (
              <>
                <span className="font-medium">{r.leave_type as string}</span>
                <span className="ml-2">
                  {fmtDate(r.start_date as string)}
                  {r.end_date && r.end_date !== r.start_date ? ` 〜 ${fmtDate(r.end_date as string)}` : ""}
                </span>
                {r.days !== null && r.days !== undefined ? <span className="text-gray-600 ml-2">{r.days as number}日</span> : null}
                {r.notes ? <p className="text-xs text-gray-500 mt-1">{r.notes as string}</p> : null}
              </>
            )}
          />
        )}

        {tab === "access" && (
          !emp.user_id ? <p className="text-sm text-gray-400">アカウントがないため、接続ログはありません</p> :
          accessLogs === null ? <p className="text-sm">読み込み中...</p> :
          accessLogs.length === 0 ? <p className="text-sm text-gray-400">まだ記録がありません</p> : (
            <>
              <p className="text-sm text-gray-600 mb-2">
                {accessLogs.length}件
                （IPアドレス {new Set(accessLogs.map((l) => l.ip).filter(Boolean)).size}種類・
                端末 {new Set(accessLogs.map((l) => `${l.device_type}${l.os}${l.device_model}`)).size}種類）
              </p>
              <div className="overflow-x-auto">
                <table className="text-xs min-w-full">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="p-2 text-left whitespace-nowrap">日時</th>
                      <th className="p-2 text-left whitespace-nowrap">種別</th>
                      <th className="p-2 text-left whitespace-nowrap">IPアドレス</th>
                      <th className="p-2 text-left whitespace-nowrap">端末</th>
                      <th className="p-2 text-left whitespace-nowrap">OS</th>
                      <th className="p-2 text-left whitespace-nowrap">ブラウザ</th>
                      <th className="p-2 text-left whitespace-nowrap">アプリ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accessLogs.map((l) => (
                      <tr key={l.id} className="border-t border-gray-200 align-top" title={l.user_agent}>
                        <td className="p-2 whitespace-nowrap tabular-nums">{fmtDateTime(l.created_at)}</td>
                        <td className="p-2 whitespace-nowrap">{l.event === "login" ? "ログイン" : "起動"}</td>
                        <td className="p-2 whitespace-nowrap font-mono">{l.ip || "—"}</td>
                        <td className="p-2 whitespace-nowrap">{l.device_type}{l.device_model && `（${l.device_model}）`}</td>
                        <td className="p-2 whitespace-nowrap">{l.os} {l.os_version}</td>
                        <td className="p-2 whitespace-nowrap">{l.browser} {l.browser_version}</td>
                        <td className="p-2 whitespace-nowrap">{l.is_installed ? "インストール版" : l.is_installed === false ? "ブラウザ" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}

        {tab === "location" && (
          !emp.user_id ? <p className="text-sm text-gray-400">アカウントがないため、位置情報はありません</p> :
          locationLogs === null ? <p className="text-sm">読み込み中...</p> :
          locationLogs.length === 0 ? <p className="text-sm text-gray-400">まだ記録がありません</p> : (
            <div className="overflow-x-auto">
              <table className="text-xs min-w-full">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="p-2 text-left whitespace-nowrap">日時</th>
                    <th className="p-2 text-left whitespace-nowrap">状態</th>
                    <th className="p-2 text-left whitespace-nowrap">場所</th>
                    <th className="p-2 text-left whitespace-nowrap">誤差</th>
                  </tr>
                </thead>
                <tbody>
                  {locationLogs.map((l) => (
                    <tr key={l.id} className="border-t border-gray-200">
                      <td className="p-2 whitespace-nowrap tabular-nums">{fmtDateTime(l.created_at)}</td>
                      <td className={`p-2 whitespace-nowrap ${l.status === "ok" ? "" : "text-orange-600"}`}>{LOCATION_STATUS[l.status] ?? l.status}</td>
                      <td className="p-2 whitespace-nowrap">
                        {l.latitude !== null && l.longitude !== null ? (
                          <a
                            href={`https://www.google.com/maps?q=${l.latitude},${l.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            地図で見る（{l.latitude.toFixed(5)}, {l.longitude.toFixed(5)}）
                          </a>
                        ) : "—"}
                      </td>
                      <td className="p-2 whitespace-nowrap">{l.accuracy !== null ? `約${Math.round(l.accuracy)}m` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}

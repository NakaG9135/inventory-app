// 従業員名簿の共通処理

export type Employee = {
  id: string;
  user_id: string | null;
  name: string;
  name_kana: string;
  department: string;
  position: string;
  employment_type: string;
  gender: string;
  birth_date: string | null;
  phone: string;
  email: string;
  current_address: string;
  family_address: string;
  marital_status: string;
  spouse_name: string;
  hire_date: string | null;
  leave_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

const parseDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, day ?? 1);
};

// 満年齢
export function ageFrom(birth: string | null | undefined, at: Date = new Date()): number | null {
  if (!birth) return null;
  const b = parseDate(birth);
  let age = at.getFullYear() - b.getFullYear();
  if (at.getMonth() < b.getMonth() || (at.getMonth() === b.getMonth() && at.getDate() < b.getDate())) age--;
  return age;
}

// 勤続年数（〇年〇か月）
export function serviceLength(hire: string | null | undefined, leave?: string | null): string {
  if (!hire) return "";
  const from = parseDate(hire);
  const to = leave ? parseDate(leave) : new Date();
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months--;
  if (months < 0) return "";
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y > 0 ? `${y}年${m}か月` : `${m}か月`;
}

export const fmtDate = (d: string | null | undefined) => (d ? d.replace(/-/g, "/") : "");

export const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const fmtYen = (n: number | null | undefined) => (n === null || n === undefined ? "" : `¥${Number(n).toLocaleString("ja-JP")}`);

export const DEPARTMENTS = ["", "総務部", "工事部"];
export const MARITAL_STATUSES = ["", "未婚", "既婚", "離別", "死別"];

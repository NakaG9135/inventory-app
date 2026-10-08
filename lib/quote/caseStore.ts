// 見積り事例（quote_cases）の読み書き
import { supabase } from "@/lib/supabaseClient";
import {
  CASE_INFO_COLUMNS,
  caseFromRow,
  caseInfoToRow,
  caseToRow,
  type QuoteCase,
  type QuoteCaseInfo,
  type QuoteCaseRow,
} from "./cases";

// 条件だけの一覧（内訳は大きいので、使う時に1件ずつ読む）
export async function fetchCaseInfos(): Promise<QuoteCaseInfo[]> {
  const rows: QuoteCaseRow[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from("quote_cases")
      .select(CASE_INFO_COLUMNS)
      .order("quote_date", { ascending: false, nullsFirst: false })
      .order("id")
      .range(from, from + size - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as QuoteCaseRow[]));
    if (!data || data.length < size) break;
  }
  return rows.map(caseFromRow);
}

export async function fetchCase(id: string): Promise<QuoteCase> {
  const { data, error } = await supabase.from("quote_cases").select(`${CASE_INFO_COLUMNS}, groups, extras`).eq("id", id).single();
  if (error) throw new Error(error.message);
  return caseFromRow(data as QuoteCaseRow);
}

export async function insertCase(c: QuoteCase): Promise<string> {
  const { data, error } = await supabase.from("quote_cases").insert(caseToRow(c)).select("id").single();
  if (error) {
    if (error.code === "23505") throw new Error("このファイルはすでに登録されています。");
    throw new Error(error.message);
  }
  return (data as { id: string }).id;
}

export async function updateCaseInfo(id: string, c: QuoteCaseInfo): Promise<void> {
  const { error } = await supabase
    .from("quote_cases")
    .update({ ...caseInfoToRow(c), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCase(id: string): Promise<void> {
  const { error } = await supabase.from("quote_cases").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

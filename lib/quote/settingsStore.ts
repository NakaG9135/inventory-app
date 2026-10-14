// 見積書の設定（quote_settings）の読み書き。今は自社情報（表紙右上の6行）だけ。
// 口座番号が入るので、既定値はリポジトリに置かずDBにだけ持つ
import { supabase } from "@/lib/supabaseClient";

const COMPANY_KEY = "company_lines";

// 保存されていなければ null
export async function fetchCompanyLines(): Promise<string[] | null> {
  const { data, error } = await supabase.from("quote_settings").select("value").eq("key", COMPANY_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const value = (data as { value: unknown } | null)?.value;
  return Array.isArray(value) ? value.map(String) : null;
}

export async function storeCompanyLines(lines: string[]): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const { error } = await supabase
    .from("quote_settings")
    .upsert(
      { key: COMPANY_KEY, value: lines, updated_at: new Date().toISOString(), updated_by: data.session?.user.id ?? null },
      { onConflict: "key" },
    );
  if (error) throw new Error(error.message);
}

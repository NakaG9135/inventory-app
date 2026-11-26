import { createClient } from "@supabase/supabase-js";
// Supabase が URL の # 以降を消す前に、再設定リンクの情報を控える
import "@/lib/recoveryLink";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

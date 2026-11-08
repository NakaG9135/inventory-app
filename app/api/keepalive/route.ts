import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Supabase の無料プランは、1週間ほどアクセスがないとデータベースが一時停止する（アプリが読み込み中のまま動かなくなる）。
// Vercel の Cron（vercel.json）から毎日1回呼んで、データベースに軽い問い合わせを1回だけする
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Vercel に CRON_SECRET を設定した時は、Cron からの呼び出しだけを受け付ける
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", {
    auth: { persistSession: false },
  });
  // 行は読まずに件数だけ（ログインしていないので RLS で0件になるが、データベースへのアクセスにはなる）
  const { error } = await supabase.from("material_prices").select("id", { count: "exact", head: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}

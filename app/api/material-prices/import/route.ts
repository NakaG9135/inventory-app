import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// 小計・合計・労務費などスキップすべき行の判定
function shouldSkipRow(name: string): boolean {
  if (!name || !name.trim()) return true;
  const skip = ["小計", "合計", "労務費", "【", "】"];
  return skip.some((k) => name.includes(k));
}

export async function POST(request: Request) {
  // 認証チェック: Authorizationヘッダーからトークンを取得
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  // ユーザーのトークンでクライアントを作成（RLSが適用される）
  const supabaseAuth = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: "認証エラー" }, { status: 401 });
  }

  // admin権限チェック
  const { data: profile } = await supabaseAuth
    .from("users_profile")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
  }

  // Excelファイルの読み取り
  const dataDir = path.join(process.cwd(), "quotedata", "quotedata");

  if (!fs.existsSync(dataDir)) {
    return NextResponse.json({ error: `フォルダが見つかりません: quotedata/quotedata/` }, { status: 400 });
  }

  const files = fs.readdirSync(dataDir).filter((f) => /\.(xlsx|xls)$/i.test(f) && !f.startsWith("~$"));

  if (files.length === 0) {
    return NextResponse.json({ error: "Excelファイルが見つかりません" }, { status: 400 });
  }

  // 全ファイルから材料データを収集
  type PriceRecord = { name: string; specification: string; unit: string; unit_price: number; source_file: string };
  const allRecords: PriceRecord[] = [];
  let skippedRows = 0;
  const fileErrors: string[] = [];

  for (const file of files) {
    try {
      const filePath = path.join(dataDir, file);
      const buf = fs.readFileSync(filePath);
      const wb = XLSX.read(buf, { type: "buffer" });

      // 内訳シートを探す
      const sheetName = wb.SheetNames.find((s) => s.includes("内訳")) || wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: "" });

      // Row0=タイトル, Row1=ヘッダー, Row2以降がデータ
      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        const name = String(row[1] ?? "").trim();
        const specification = String(row[2] ?? "").trim();
        const unit = String(row[3] ?? "").trim();
        const unitPrice = parseFloat(String(row[5] ?? "0"));

        if (shouldSkipRow(name)) {
          skippedRows++;
          continue;
        }

        if (isNaN(unitPrice) || unitPrice <= 0) {
          skippedRows++;
          continue;
        }

        allRecords.push({
          name,
          specification,
          unit,
          unit_price: unitPrice,
          source_file: file,
        });
      }
    } catch (err) {
      fileErrors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 名称+規格でグルーピングし、最高単価を採用
  const priceMap = new Map<string, PriceRecord>();
  for (const rec of allRecords) {
    const key = `${rec.name}|||${rec.specification}`;
    const existing = priceMap.get(key);
    if (!existing || rec.unit_price > existing.unit_price) {
      priceMap.set(key, rec);
    }
  }

  const dedupedRecords = Array.from(priceMap.values());

  if (dedupedRecords.length === 0) {
    return NextResponse.json({
      message: "取込可能なデータがありませんでした",
      totalFiles: files.length,
      skippedRows,
      fileErrors,
    });
  }

  // Supabaseにバッチupsert（サービスロールキーがあればそれを使う、なければanonキー）
  const supabaseWrite = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : supabaseAuth;

  const BATCH_SIZE = 500;
  let upsertedCount = 0;
  const upsertErrors: string[] = [];

  for (let i = 0; i < dedupedRecords.length; i += BATCH_SIZE) {
    const batch = dedupedRecords.slice(i, i + BATCH_SIZE).map((r) => ({
      name: r.name,
      specification: r.specification,
      unit: r.unit,
      unit_price: r.unit_price,
      source_file: r.source_file,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabaseWrite
      .from("material_prices")
      .upsert(batch, { onConflict: "name,specification" });

    if (error) {
      upsertErrors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
    } else {
      upsertedCount += batch.length;
    }
  }

  return NextResponse.json({
    message: `${upsertedCount}件の材料単価を取込みました`,
    totalFiles: files.length,
    totalRecords: allRecords.length,
    dedupedCount: dedupedRecords.length,
    upsertedCount,
    skippedRows,
    fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
    upsertErrors: upsertErrors.length > 0 ? upsertErrors : undefined,
  });
}

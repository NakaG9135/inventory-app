import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function POST(request: Request) {
  // 認証チェック
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const supabaseAuth = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: "認証エラー" }, { status: 401 });
  }

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

  // 全ファイルからデータを収集
  type PriceRecord = {
    category: string;
    name: string;
    specification: string;
    unit: string;
    unit_price: number;
    source_file: string;
  };
  const allRecords: PriceRecord[] = [];
  const fileErrors: string[] = [];

  for (const file of files) {
    try {
      const filePath = path.join(dataDir, file);
      const buf = fs.readFileSync(filePath);
      const wb = XLSX.read(buf, { type: "buffer" });

      // 「内訳」を含むシート全て対象、「表紙」を含むシートは除外
      const sheetsToProcess = wb.SheetNames.filter(
        (s) => s.includes("内訳") && !s.includes("表紙")
      );

      if (sheetsToProcess.length === 0) {
        fileErrors.push(`${file}: 対象シートが見つかりません`);
        continue;
      }

      for (const sheetName of sheetsToProcess) {
        const ws = wb.Sheets[sheetName];
        if (!ws) continue;

        const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: "" });

        // セクション追跡: 材料費/労務費/それ以外
        // 「材料費」→小計 = 材料費、「労務費」→小計 = 労務費、それ以外 = その他
        let currentCategory: string | null = null;

        for (let i = 2; i < rows.length; i++) {
          const row = rows[i];
          const name = String(row[1] ?? "").trim();

          // セクションヘッダー
          if (name === "材料費") { currentCategory = "材料費"; continue; }
          if (name === "労務費") { currentCategory = "労務費"; continue; }

          // セクション終了（小計/合計）
          if (name.includes("小計") || name.includes("合計")) { currentCategory = null; continue; }

          // 構造行スキップ
          if (name.includes("【") && name.includes("】")) continue;
          if (!name) continue;

          const specification = String(row[2] ?? "").trim();
          const unit = String(row[3] ?? "").trim();
          const rawPrice = parseFloat(String(row[5] ?? ""));
          const unitPrice = isNaN(rawPrice) ? 0 : rawPrice;

          // 単価が書いてないもの（0または空）は抽出しない
          if (unitPrice <= 0) continue;

          // セクション外のデータは「その他」
          const category = currentCategory || "その他";

          allRecords.push({
            category,
            name,
            specification,
            unit,
            unit_price: unitPrice,
            source_file: `${file} [${sheetName}]`,
          });
        }
      }
    } catch (err) {
      fileErrors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (allRecords.length === 0) {
    return NextResponse.json({
      message: "取込可能なデータがありませんでした",
      totalFiles: files.length,
      fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
    });
  }

  // Supabaseにバッチinsert
  const supabaseWrite = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : supabaseAuth;

  const BATCH_SIZE = 200;
  let insertedCount = 0;
  const insertErrors: string[] = [];

  for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
    const batch = allRecords.slice(i, i + BATCH_SIZE).map((r) => ({
      category: r.category,
      name: r.name,
      specification: r.specification,
      unit: r.unit,
      unit_price: r.unit_price,
      source_file: r.source_file,
    }));

    const { error } = await supabaseWrite
      .from("material_prices")
      .insert(batch);

    if (error) {
      insertErrors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1} (rows ${i + 1}-${i + batch.length}): ${error.message}`);
    } else {
      insertedCount += batch.length;
    }
  }

  const materialCount = allRecords.filter((r) => r.category === "材料費").length;
  const laborCount = allRecords.filter((r) => r.category === "労務費").length;
  const otherCount = allRecords.filter((r) => r.category === "その他").length;

  return NextResponse.json({
    message: `${insertedCount}件を取込みました（材料費: ${materialCount}件 / 労務費: ${laborCount}件 / その他: ${otherCount}件）`,
    totalFiles: files.length,
    totalRecords: allRecords.length,
    materialCount,
    laborCount,
    otherCount,
    insertedCount,
    fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
    insertErrors: insertErrors.length > 0 ? insertErrors : undefined,
  });
}

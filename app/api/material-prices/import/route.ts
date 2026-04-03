import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// セクション区切りの判定
function isSectionHeader(name: string): "材料費" | "労務費" | null {
  if (name === "材料費") return "材料費";
  if (name === "労務費") return "労務費";
  return null;
}

function isSectionEnd(name: string): boolean {
  return name.includes("小計") || name.includes("合計");
}

// セクションヘッダー・区切り行のみスキップ（データ行は全て取込）
function isStructuralRow(name: string): boolean {
  if (name === "材料費" || name === "労務費") return true;
  if (name.includes("小計") || name.includes("合計")) return true;
  if (name.includes("【") && name.includes("】")) return true;
  return false;
}

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

  // 全ファイルから材料・労務データを収集（重複排除なし・全件取込）
  type PriceRecord = {
    category: "材料費" | "労務費";
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

      // 内訳シートを探す（複数の内訳シートがある場合は全て処理）
      const uchiwakeSheets = wb.SheetNames.filter((s) => s.includes("内訳"));
      const sheetsToProcess = uchiwakeSheets.length > 0 ? uchiwakeSheets : [wb.SheetNames[0]];

      for (const sheetName of sheetsToProcess) {
        const ws = wb.Sheets[sheetName];
        if (!ws) continue;

        const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: "" });

        // セクション追跡: 「材料費」→データ→「小計」、「労務費」→データ→「小計」
        let currentCategory: "材料費" | "労務費" | null = null;

        for (let i = 2; i < rows.length; i++) {
          const row = rows[i];
          const name = String(row[1] ?? "").trim();

          // セクションヘッダーチェック
          const sectionHeader = isSectionHeader(name);
          if (sectionHeader) {
            currentCategory = sectionHeader;
            continue;
          }

          // セクション終了チェック
          if (isSectionEnd(name)) {
            currentCategory = null;
            continue;
          }

          // セクション外 or 構造行はスキップ
          if (!currentCategory) continue;
          if (isStructuralRow(name)) continue;

          // 名称が空の行もスキップ
          if (!name) continue;

          const specification = String(row[2] ?? "").trim();
          const unit = String(row[3] ?? "").trim();
          const rawPrice = String(row[5] ?? "0");
          const unitPrice = parseFloat(rawPrice) || 0;

          allRecords.push({
            category: currentCategory,
            name,
            specification,
            unit,
            unit_price: unitPrice,
            source_file: file,
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

  // Supabaseにバッチinsert（重複排除なし・全件挿入）
  const supabaseWrite = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : supabaseAuth;

  const BATCH_SIZE = 500;
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
      insertErrors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
    } else {
      insertedCount += batch.length;
    }
  }

  const materialCount = allRecords.filter((r) => r.category === "材料費").length;
  const laborCount = allRecords.filter((r) => r.category === "労務費").length;

  return NextResponse.json({
    message: `${insertedCount}件を取込みました（材料費: ${materialCount}件 / 労務費: ${laborCount}件）`,
    totalFiles: files.length,
    totalRecords: allRecords.length,
    materialCount,
    laborCount,
    insertedCount,
    fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
    insertErrors: insertErrors.length > 0 ? insertErrors : undefined,
  });
}

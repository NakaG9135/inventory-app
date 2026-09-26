import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// 画面からアップロードされたExcelファイル（1リクエスト1ファイル）を取込む
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

  // アップロードファイルの受け取り
  let file: File | null = null;
  try {
    const formData = await request.formData();
    const entry = formData.get("file");
    if (entry instanceof File) file = entry;
  } catch {
    return NextResponse.json({ error: "ファイルの受け取りに失敗しました" }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json({ error: "ファイルが選択されていません" }, { status: 400 });
  }

  const fileName = file.name;
  if (!/\.(xlsx|xls)$/i.test(fileName) || fileName.startsWith("~$")) {
    return NextResponse.json({ fileName, error: "Excelファイル(.xlsx/.xls)ではありません" }, { status: 400 });
  }

  // DB書き込み用クライアント
  const supabaseWrite = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : supabaseAuth;

  // 取込済みチェック（source_fileは "ファイル名.xlsx [内訳]" 形式）
  const { count: existingCount, error: existingError } = await supabaseWrite
    .from("material_prices")
    .select("id", { count: "exact", head: true })
    .like("source_file", `${fileName.replace(/[\\%_]/g, "\\$&")} [%`);

  if (existingError) {
    return NextResponse.json({ fileName, error: `取込済みチェックに失敗: ${existingError.message}` }, { status: 500 });
  }
  if ((existingCount ?? 0) > 0) {
    return NextResponse.json({ fileName, skipped: true, insertedCount: 0 });
  }

  // Excelからデータを収集
  type PriceRecord = {
    category: string;
    name: string;
    specification: string;
    unit: string;
    unit_price: number;
    source_file: string;
  };
  const allRecords: PriceRecord[] = [];

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });

    // 「内訳」を含むシート全て対象、「表紙」を含むシートは除外
    const sheetsToProcess = wb.SheetNames.filter(
      (s) => s.includes("内訳") && !s.includes("表紙")
    );

    if (sheetsToProcess.length === 0) {
      return NextResponse.json({ fileName, fileError: "対象シート（内訳）が見つかりません", insertedCount: 0 });
    }

    for (const sheetName of sheetsToProcess) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: "" });

      let currentCategory: string | null = null;

      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        const name = String(row[1] ?? "").trim();

        if (name === "材料費") { currentCategory = "材料費"; continue; }
        if (name === "労務費") { currentCategory = "労務費"; continue; }
        if (name.includes("小計") || name.includes("合計")) { currentCategory = null; continue; }
        if (name.includes("【") && name.includes("】")) continue;
        if (!name) continue;

        const specification = String(row[2] ?? "").trim();
        const unit = String(row[3] ?? "").trim();
        const rawPrice = parseFloat(String(row[5] ?? ""));
        const unitPrice = isNaN(rawPrice) ? 0 : rawPrice;

        if (unitPrice <= 0) continue;

        allRecords.push({
          category: currentCategory || "その他",
          name,
          specification,
          unit,
          unit_price: unitPrice,
          source_file: `${fileName} [${sheetName}]`,
        });
      }
    }
  } catch (err) {
    return NextResponse.json({ fileName, fileError: err instanceof Error ? err.message : String(err), insertedCount: 0 });
  }

  // DBにinsert
  const BATCH_SIZE = 200;
  let insertedCount = 0;
  const insertErrors: string[] = [];

  for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
    const batch = allRecords.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseWrite
      .from("material_prices")
      .insert(batch);

    if (error) {
      insertErrors.push(`${fileName} Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
    } else {
      insertedCount += batch.length;
    }
  }

  return NextResponse.json({
    fileName,
    insertedCount,
    materialCount: allRecords.filter((r) => r.category === "材料費").length,
    laborCount: allRecords.filter((r) => r.category === "労務費").length,
    otherCount: allRecords.filter((r) => r.category === "その他").length,
    insertErrors: insertErrors.length > 0 ? insertErrors : undefined,
  });
}

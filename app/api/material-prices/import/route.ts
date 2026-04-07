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
  const oldDir = path.join(process.cwd(), "quotedata", "olddata");

  if (!fs.existsSync(dataDir)) {
    return NextResponse.json({ error: `フォルダが見つかりません: quotedata/quotedata/` }, { status: 400 });
  }

  // olddataフォルダがなければ作成
  if (!fs.existsSync(oldDir)) {
    fs.mkdirSync(oldDir, { recursive: true });
  }

  const allFiles = fs.readdirSync(dataDir).filter((f) => /\.(xlsx|xls)$/i.test(f) && !f.startsWith("~$"));

  if (allFiles.length === 0) {
    return NextResponse.json({ error: "Excelファイルが見つかりません" }, { status: 400 });
  }

  // DB書き込み用クライアント
  const supabaseWrite = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : supabaseAuth;

  // DBから取込済みファイル名一覧を取得（source_fileから元ファイル名を抽出）
  const { data: existingData } = await supabaseWrite
    .from("material_prices")
    .select("source_file");

  const importedFileNames = new Set<string>();
  if (existingData) {
    for (const row of existingData) {
      // source_fileは "ファイル名.xlsx [内訳]" 形式なので、元ファイル名を抽出
      const match = String(row.source_file).match(/^(.+?\.(xlsx|xls))/i);
      if (match) {
        importedFileNames.add(match[1]);
      }
    }
  }

  // 未取込のファイルのみ対象
  const newFiles = allFiles.filter((f) => !importedFileNames.has(f));
  const skippedFiles = allFiles.filter((f) => importedFileNames.has(f));

  if (newFiles.length === 0) {
    return NextResponse.json({
      message: "新しいファイルはありません（全て取込済み）",
      totalFiles: allFiles.length,
      skippedFiles: skippedFiles.length,
    });
  }

  // 新規ファイルからデータを収集
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
  const processedFiles: string[] = [];

  for (const file of newFiles) {
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
        // シートがなくてもprocessed扱いにして移動する
        processedFiles.push(file);
        continue;
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

      processedFiles.push(file);
    } catch (err) {
      fileErrors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // DBにinsert
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
      insertErrors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
    } else {
      insertedCount += batch.length;
    }
  }

  // 取込成功したファイルをolddataに移動
  const movedFiles: string[] = [];
  const moveErrors: string[] = [];

  if (insertErrors.length === 0) {
    for (const file of processedFiles) {
      try {
        const src = path.join(dataDir, file);
        const dst = path.join(oldDir, file);
        // 同名ファイルが既にolddataにある場合は上書き
        fs.renameSync(src, dst);
        movedFiles.push(file);
      } catch (err) {
        moveErrors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const materialCount = allRecords.filter((r) => r.category === "材料費").length;
  const laborCount = allRecords.filter((r) => r.category === "労務費").length;
  const otherCount = allRecords.filter((r) => r.category === "その他").length;

  return NextResponse.json({
    message: `${insertedCount}件を取込みました（材料費: ${materialCount}件 / 労務費: ${laborCount}件 / その他: ${otherCount}件）`,
    totalFiles: allFiles.length,
    newFiles: newFiles.length,
    skippedFiles: skippedFiles.length,
    totalRecords: allRecords.length,
    materialCount,
    laborCount,
    otherCount,
    insertedCount,
    movedFiles: movedFiles.length > 0 ? movedFiles : undefined,
    moveErrors: moveErrors.length > 0 ? moveErrors : undefined,
    fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
    insertErrors: insertErrors.length > 0 ? insertErrors : undefined,
  });
}

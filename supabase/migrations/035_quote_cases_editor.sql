-- 見積り作成の画面で作った見積りを、見積り事例に保存して、あとで開いて直せるようにする。
-- editor ＝ 画面の中身そのもの（内訳の単価の出どころ・摘要・※の注意書き・計算の設定など）。
-- Excelから登録した過去の見積りは null（開く時は groups・extras から作る）。
-- 自社情報（取引銀行・口座）は入れない

alter table public.quote_cases add column if not exists editor jsonb;

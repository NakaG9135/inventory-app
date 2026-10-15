-- 見積り作成で保存した見積りの単価（単価表になかった・変えた単価）を材料単価に登録する。
-- sale_type    ＝ 材料の区分（新品売りつけ・中古売りつけ・新品リース・中古リース。空＝区分なし）
-- company_name ＝ その単価を使った見積りの宛先（会社名）
-- quote_case_id ＝ 登録元の見積り事例。上書き保存の時に、前に登録した分を入れ替えるのに使う
--                 （見積り事例を削除しても単価は残す）

alter table public.material_prices add column if not exists sale_type text not null default '';
alter table public.material_prices add column if not exists company_name text not null default '';
alter table public.material_prices add column if not exists quote_case_id uuid references public.quote_cases(id) on delete set null;

create index if not exists material_prices_quote_case_idx on public.material_prices (quote_case_id) where quote_case_id is not null;

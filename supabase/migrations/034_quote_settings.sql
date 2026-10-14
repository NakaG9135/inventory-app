-- 見積書の設定（今は自社情報＝表紙右上の6行：住所・社名・電話・取引銀行・口座・登録番号）
-- 口座番号は公開リポジトリに置かないので、値はこの表にだけ持つ。新規・似た見積りから作る時にも自動で入れる
-- 権限は「見積り作成」：閲覧以上で読む・保存できる（見積書に印刷する内容を、見積りを作る人が直せるように）

create table if not exists public.quote_settings (
  key text primary key,                         -- 設定の名前（company_lines＝自社情報）
  value jsonb not null default 'null'::jsonb,   -- 設定の値
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.quote_settings enable row level security;

create policy "perm_select_quote_settings" on public.quote_settings
  for select to authenticated using ((select public.page_level('quotes')) >= 1);
create policy "perm_insert_quote_settings" on public.quote_settings
  for insert to authenticated with check ((select public.page_level('quotes')) >= 1);
create policy "perm_update_quote_settings" on public.quote_settings
  for update to authenticated using ((select public.page_level('quotes')) >= 1);

revoke all on public.quote_settings from anon;

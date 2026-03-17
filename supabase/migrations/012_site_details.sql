-- 現場リスト: 手動入力項目を保存するテーブル
create table if not exists site_details (
  id uuid default gen_random_uuid() primary key,
  site_name text not null unique,
  address text not null default '',
  office_location text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS
alter table site_details enable row level security;

create policy "auth_select_site_details" on site_details for select to authenticated using (true);
create policy "auth_insert_site_details" on site_details for insert to authenticated with check (true);
create policy "auth_update_site_details" on site_details for update to authenticated using (true);
create policy "auth_delete_site_details" on site_details for delete to authenticated using (true);

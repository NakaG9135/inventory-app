-- 貸出: 貸出物マスタ（adminが管理）
create table if not exists lending_items (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  created_at timestamptz default now()
);

-- 貸出: 貸出記録
create table if not exists lending_records (
  id uuid default gen_random_uuid() primary key,
  lending_item_id uuid not null references lending_items(id) on delete cascade,
  site_name text not null,
  manager_name text not null default '',
  registrant_name text not null default '',
  period_start date not null,
  period_end date not null,
  returned boolean not null default false,
  returned_at timestamptz,
  created_at timestamptz default now()
);

-- RLS
alter table lending_items enable row level security;
alter table lending_records enable row level security;

-- lending_items policies
create policy "auth_select_lending_items" on lending_items for select to authenticated using (true);
create policy "auth_insert_lending_items" on lending_items for insert to authenticated with check (true);
create policy "auth_update_lending_items" on lending_items for update to authenticated using (true);
create policy "auth_delete_lending_items" on lending_items for delete to authenticated using (true);

-- lending_records policies
create policy "auth_select_lending_records" on lending_records for select to authenticated using (true);
create policy "auth_insert_lending_records" on lending_records for insert to authenticated with check (true);
create policy "auth_update_lending_records" on lending_records for update to authenticated using (true);
create policy "auth_delete_lending_records" on lending_records for delete to authenticated using (true);

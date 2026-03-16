-- 車両マスタテーブル
create table if not exists vehicles (
  id uuid default gen_random_uuid() primary key,
  number text not null,
  vehicle_type text not null default '',
  model text not null default '',
  fuel_type text not null default '',
  created_at timestamptz default now()
);

-- RLSポリシー
alter table vehicles enable row level security;

create policy "authenticated users can select vehicles"
  on vehicles for select
  to authenticated
  using (true);

create policy "authenticated users can insert vehicles"
  on vehicles for insert
  to authenticated
  with check (true);

create policy "authenticated users can update vehicles"
  on vehicles for update
  to authenticated
  using (true);

create policy "authenticated users can delete vehicles"
  on vehicles for delete
  to authenticated
  using (true);

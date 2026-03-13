-- 日報テーブル
create table if not exists daily_reports (
  id uuid default gen_random_uuid() primary key,
  site_name text not null,
  work_date date not null,
  work_time text,
  vehicles text[] default '{}',
  workers text[] default '{}',
  user_id uuid references auth.users(id),
  created_at timestamptz default now()
);

-- 日報使用部材テーブル
create table if not exists daily_report_materials (
  id uuid default gen_random_uuid() primary key,
  report_id uuid references daily_reports(id) on delete cascade,
  item_id uuid references inventory(id),
  quantity integer not null
);

-- RLS
alter table daily_reports enable row level security;
alter table daily_report_materials enable row level security;

create policy "authenticated users can insert daily_reports"
  on daily_reports for insert to authenticated with check (auth.uid() = user_id);

create policy "authenticated users can select daily_reports"
  on daily_reports for select to authenticated using (true);

create policy "authenticated users can insert daily_report_materials"
  on daily_report_materials for insert to authenticated with check (true);

create policy "authenticated users can select daily_report_materials"
  on daily_report_materials for select to authenticated using (true);

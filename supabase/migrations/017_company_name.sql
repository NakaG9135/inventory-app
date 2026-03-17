-- 各テーブルに会社名カラムを追加
alter table material_reserve_sites add column if not exists company_name text not null default '';
alter table daily_reports add column if not exists company_name text not null default '';
alter table inventory_logs add column if not exists company_name text not null default '';
alter table lending_records add column if not exists company_name text not null default '';
alter table site_details add column if not exists company_name text not null default '';

-- 返却種別カラムを追加（'通常' or '前倒し'）
alter table lending_records add column if not exists return_type text not null default '';

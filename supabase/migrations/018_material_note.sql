-- 日報使用部材に備考カラムを追加
alter table daily_report_materials add column if not exists note text not null default '';

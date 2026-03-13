-- 使用部材にグループインデックスを追加
alter table daily_report_materials add column if not exists group_index integer default 0;

-- 日報にグループ名（工区名）配列を追加
alter table daily_reports add column if not exists material_group_labels text[] default '{}';

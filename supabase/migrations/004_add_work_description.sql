-- daily_reports に作業内容カラムを追加
alter table daily_reports add column if not exists work_description text;

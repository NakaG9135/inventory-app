-- 材料確保に使用予定日カラムを追加
alter table material_reserve_items add column if not exists planned_date text not null default '';

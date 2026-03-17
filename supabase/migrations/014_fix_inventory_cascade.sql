-- daily_report_materialsのitem_id外部キーにon delete cascadeを追加
alter table daily_report_materials drop constraint if exists daily_report_materials_item_id_fkey;
alter table daily_report_materials add constraint daily_report_materials_item_id_fkey
  foreign key (item_id) references inventory(id) on delete cascade;

-- inventory_logsのitem_id外部キーにon delete cascadeを追加
alter table inventory_logs drop constraint if exists inventory_logs_item_id_fkey;
alter table inventory_logs add constraint inventory_logs_item_id_fkey
  foreign key (item_id) references inventory(id) on delete cascade;

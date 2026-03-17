-- ユニーク制約を (site_id, item_id) から (site_id, item_id, planned_date) に変更
alter table material_reserve_items drop constraint if exists material_reserve_items_site_id_item_id_key;
alter table material_reserve_items add constraint material_reserve_items_site_item_date_key unique (site_id, item_id, planned_date);

-- ユニーク制約を削除（重複許可）
drop index if exists idx_material_prices_cat_name_spec;
drop index if exists idx_material_prices_name_spec;

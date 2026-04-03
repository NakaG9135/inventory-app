-- 材料費/労務費の区分列を追加
alter table material_prices add column if not exists category text not null default '材料費';

-- 旧ユニーク制約を削除して、category含みの新制約を作成
drop index if exists idx_material_prices_name_spec;
create unique index idx_material_prices_cat_name_spec
  on material_prices (category, name, specification);

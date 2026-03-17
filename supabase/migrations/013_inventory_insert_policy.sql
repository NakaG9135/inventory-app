-- inventoryテーブルにINSERTポリシーを追加（日報から新規登録用）
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'inventory' and policyname = 'auth_insert_inventory'
  ) then
    create policy "auth_insert_inventory" on inventory for insert to authenticated with check (true);
  end if;
end $$;

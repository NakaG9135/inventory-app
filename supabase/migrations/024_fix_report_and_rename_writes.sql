-- 以前から RLS で拒否され動いていなかった書込みを、権限付きで使えるようにする

-- 1) 一時保存した日報の削除：自分の下書きのみ（材料は ON DELETE CASCADE で消える）
drop policy if exists "perm_delete_own_draft_reports" on public.daily_reports;
create policy "perm_delete_own_draft_reports" on public.daily_reports
  for delete to authenticated
  using (
    user_id = auth.uid()
    and status = 'draft'
    and (select public.page_level('report')) >= 2
  );

-- 2) 日報ログの会社名修正（他の人の日報も対象）：日報ログ「編集」
create or replace function public.update_report_company(p_report_id uuid, p_company text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.page_level('report_logs') < 3 then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  update public.daily_reports
  set company_name = coalesce(trim(p_company), '')
  where id = p_report_id;
end;
$$;

-- 3) 現場名の変更を関連データへ反映：現場リスト「編集」
create or replace function public.rename_site_references(p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.page_level('sites') < 3 then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  if coalesce(trim(p_new), '') = '' then
    raise exception '現場名が空です';
  end if;
  update public.daily_reports set site_name = trim(p_new) where site_name = p_old;
  update public.inventory_logs set site_name = trim(p_new) where site_name = p_old;
  update public.lending_records set site_name = trim(p_new) where site_name = p_old;
end;
$$;

-- 4) 会社名の変更・削除（p_new が空なら削除）を全データへ反映：現場リスト「編集」
create or replace function public.rename_company(p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new text := coalesce(trim(p_new), '');
begin
  if public.page_level('sites') < 3 then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  if coalesce(p_old, '') = '' then
    raise exception '変更前の会社名が空です';
  end if;
  update public.material_reserve_sites set company_name = v_new where company_name = p_old;
  update public.daily_reports set company_name = v_new where company_name = p_old;
  update public.inventory_logs set company_name = v_new where company_name = p_old;
  update public.lending_records set company_name = v_new where company_name = p_old;
  update public.site_details set company_name = v_new where company_name = p_old;
end;
$$;

revoke execute on function public.update_report_company(uuid, text) from public, anon;
revoke execute on function public.rename_site_references(text, text) from public, anon;
revoke execute on function public.rename_company(text, text) from public, anon;
grant execute on function public.update_report_company(uuid, text) to authenticated;
grant execute on function public.rename_site_references(text, text) to authenticated;
grant execute on function public.rename_company(text, text) to authenticated;

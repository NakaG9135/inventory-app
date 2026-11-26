-- パスワードを忘れた時の再設定
--   1) 社長が従業員名簿から再設定する
--   2) 本人がログイン画面から、メールアドレス・氏名・生年月日の一致で再設定する
--   3) 生年月日が未登録の人には、ログイン後に入力してもらい名簿に記録する
-- パスワードは元に戻せない形で保存されていて誰にも読めないので、「表示」ではなく「新しいパスワードに置き換える」

-- ========== 共通 ==========
-- パスワードの決まり（新規登録の画面と同じ。72バイトを超える分は暗号化の仕組み上使われないので断る）
create or replace function public.is_valid_password(p_password text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_password is not null
     and length(p_password) >= 10
     and octet_length(p_password) <= 72
     and p_password ~ '[a-z]'
     and p_password ~ '[A-Z]'
     and p_password ~ '[0-9]'
     and p_password ~ '[!@#$%^&*]';
$$;

-- パスワードを置き換える（下の関数からだけ使う。画面からは直接呼べない）
create or replace function public.set_user_password(p_user_id uuid, p_new_password text)
returns boolean
language plpgsql
set search_path = public, extensions
as $$
begin
  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_user_id;
  if not found then
    return false;
  end if;

  -- 古いパスワードでログインしたままの端末は、ログインし直しにする
  delete from auth.sessions where user_id = p_user_id;

  update public.users_profile set failed_attempts = 0, locked = false where id = p_user_id;
  return true;
end;
$$;

revoke execute on function public.is_valid_password(text) from public, anon, authenticated;
revoke execute on function public.set_user_password(uuid, text) from public, anon, authenticated;

-- ========== 1) 社長が従業員名簿から再設定 ==========
-- 名簿の「アカウント」欄用：ログインに使うメールアドレスと最終ログイン
create or replace function public.employee_account_info(p_user_id uuid)
returns table (email text, last_sign_in_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  return query
  select u.email::text, u.last_sign_in_at from auth.users u where u.id = p_user_id;
end;
$$;

create or replace function public.admin_reset_user_password(p_user_id uuid, p_new_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_admin_name text;
  v_summary text;
begin
  if not public.is_super_admin() then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'ご自身のパスワードは「登録情報変更」の画面で変更してください';
  end if;
  if not public.is_valid_password(p_new_password) then
    raise exception 'パスワードは大文字・小文字・数字・記号を含み10文字以上（72文字まで）にしてください';
  end if;
  if not public.set_user_password(p_user_id, p_new_password) then
    raise exception 'アカウントが見つかりません';
  end if;

  -- 操作ログに残す（パスワードそのものは記録しない）
  select coalesce(name, '') into v_name from public.users_profile where id = p_user_id;
  select coalesce(name, '') into v_admin_name from public.users_profile where id = auth.uid();
  v_summary := 'アカウント「' || coalesce(v_name, '') || '」のパスワードを再設定';
  insert into public.operation_logs (
    user_id, user_name, action, table_name, category, summary, record_id, search_text
  ) values (
    auth.uid(), coalesce(v_admin_name, ''), 'update', 'users_profile', 'アカウント', v_summary, p_user_id::text,
    lower(concat_ws(' ', v_admin_name, '変更', v_summary))
  );
end;
$$;

revoke execute on function public.employee_account_info(uuid) from public, anon;
revoke execute on function public.admin_reset_user_password(uuid, text) from public, anon;
grant execute on function public.employee_account_info(uuid) to authenticated;
grant execute on function public.admin_reset_user_password(uuid, text) to authenticated;

-- ========== 2) 本人がログイン画面から再設定（メールアドレス・氏名・生年月日の一致） ==========
-- 試した記録（総当たりを止めるため）
create table if not exists public.password_reset_attempts (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  email text not null default '',
  ip text not null default '',
  success boolean not null default false
);
create index if not exists password_reset_attempts_email_idx on public.password_reset_attempts (email, created_at desc);
create index if not exists password_reset_attempts_ip_idx on public.password_reset_attempts (ip, created_at desc);

alter table public.password_reset_attempts enable row level security;
-- ポリシーなし＝直接の読み書きは不可。記録は関数経由のみ。
revoke all on public.password_reset_attempts from anon, authenticated;

-- 戻り値：ok＝変更した / mismatch＝一致しない / locked＝間違いが続いて一時停止中 / invalid_password＝決まりに合わない
-- ・どの項目が違うかは返さない（登録の有無や生年月日を探られないようにするため）
-- ・同じメールアドレスで1時間に5回、同じ接続元から1時間に20回間違えると、1時間受け付けない
-- ・社長のアカウントは対象外（名簿と権限を扱えるため、氏名と生年月日だけでは変えられないようにする）
-- ・生年月日が未登録の人も対象外
create or replace function public.reset_password_by_identity(
  p_email text,
  p_last_name text,
  p_first_name text,
  p_birth_date date,
  p_new_password text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := regexp_replace(coalesce(p_last_name, '') || coalesce(p_first_name, ''), '[\s　]+', '', 'g');
  v_headers json := nullif(current_setting('request.headers', true), '')::json;
  v_ip text;
  v_user_id uuid;
  v_emp_name text;
  v_failures int;
  v_summary text;
begin
  v_ip := coalesce(
    nullif(v_headers->>'cf-connecting-ip', ''),
    nullif(v_headers->>'x-real-ip', ''),
    nullif(trim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), ''),
    ''
  );

  if not public.is_valid_password(p_new_password) then
    return 'invalid_password';
  end if;

  delete from public.password_reset_attempts where created_at < now() - interval '30 days';

  if (select count(*) from public.password_reset_attempts
       where email = v_email and not success and created_at > now() - interval '1 hour') >= 5
     or (v_ip <> '' and (select count(*) from public.password_reset_attempts
       where ip = v_ip and not success and created_at > now() - interval '1 hour') >= 20) then
    return 'locked';
  end if;

  -- 氏名は空白（半角・全角）を除いて比べる
  select u.id, e.name into v_user_id, v_emp_name
    from auth.users u
    join public.users_profile p on p.id = u.id
    join public.employees e on e.user_id = u.id
   where lower(u.email) = v_email
     and not p.is_super_admin
     and p_birth_date is not null
     and e.birth_date = p_birth_date
     and v_name <> ''
     and regexp_replace(e.name, '[\s　]+', '', 'g') = v_name
   limit 1;

  if v_user_id is null then
    insert into public.password_reset_attempts (email, ip, success) values (v_email, v_ip, false);
    select count(*) into v_failures from public.password_reset_attempts
     where email = v_email and not success and created_at > now() - interval '1 hour';
    if v_failures = 5 then
      v_summary := 'パスワード再設定の本人確認が5回続けて失敗（' || left(v_email, 100) || '）。1時間受け付けを止めました';
      insert into public.operation_logs (
        user_id, user_name, action, table_name, category, summary, search_text
      ) values (
        null, 'システム', 'update', 'users_profile', 'アカウント', v_summary, lower(concat_ws(' ', 'システム', v_summary))
      );
    end if;
    return 'mismatch';
  end if;

  perform public.set_user_password(v_user_id, p_new_password);
  insert into public.password_reset_attempts (email, ip, success) values (v_email, v_ip, true);

  v_summary := 'アカウント「' || coalesce(v_emp_name, '') || '」が氏名と生年月日の確認でパスワードを再設定';
  insert into public.operation_logs (
    user_id, user_name, action, table_name, category, summary, record_id, search_text
  ) values (
    v_user_id, coalesce(v_emp_name, ''), 'update', 'users_profile', 'アカウント', v_summary, v_user_id::text,
    lower(concat_ws(' ', v_emp_name, '変更', v_summary))
  );
  return 'ok';
end;
$$;

revoke execute on function public.reset_password_by_identity(text, text, text, date, text) from public;
grant execute on function public.reset_password_by_identity(text, text, text, date, text) to anon, authenticated;

-- ========== 3) 生年月日が未登録の人に、ログイン後に入力してもらう ==========
-- 名簿は社長しか読めないので、本人の分だけを関数経由で確認・記録する
create or replace function public.my_birth_date_needed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.employees where user_id = auth.uid() and birth_date is null);
$$;

-- 記録できるのは未登録の時の1回だけ（入力後の訂正は、社長が名簿で行う）
create or replace function public.set_my_birth_date(p_birth_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインしてください' using errcode = '42501';
  end if;
  if p_birth_date is null or p_birth_date < date '1900-01-01' or p_birth_date > current_date then
    raise exception '生年月日が正しくありません';
  end if;
  update public.employees set birth_date = p_birth_date
   where user_id = auth.uid() and birth_date is null;
end;
$$;

revoke execute on function public.my_birth_date_needed() from public, anon;
revoke execute on function public.set_my_birth_date(date) from public, anon;
grant execute on function public.my_birth_date_needed() to authenticated;
grant execute on function public.set_my_birth_date(date) to authenticated;

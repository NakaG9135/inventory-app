-- auth.usersからlast_sign_in_atを取得する関数
create or replace function get_users_last_sign_in()
returns table (user_id uuid, last_sign_in_at timestamptz)
language sql
security definer
as $$
  select id, last_sign_in_at from auth.users;
$$;

-- users_profileのlast_login_atカラムは不要になったが、既存データに影響しないため残す

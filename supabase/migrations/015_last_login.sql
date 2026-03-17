-- users_profileに最終ログイン日時カラムを追加
alter table users_profile add column if not exists last_login_at timestamptz;

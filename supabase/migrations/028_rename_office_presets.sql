-- 総務部事務 / 総務部経理 に名称変更
update public.permission_presets set label = '総務部事務' where key = 'office';
update public.permission_presets set label = '総務部経理' where key = 'office_keiri';

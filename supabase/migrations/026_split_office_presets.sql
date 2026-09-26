-- 事務部を「事務部総務」「事務部経理」に分ける（既存の事務部は総務に）
update public.permission_presets set label = '事務部総務' where key = 'office';

insert into public.permission_presets (key, department, label, sort_order)
values ('office_keiri', 'office', '事務部経理', 15)
on conflict (key) do nothing;

-- 経理の初期値は総務と同じ
insert into public.permission_preset_levels (preset_key, page_key, level)
select 'office_keiri', page_key, level
from public.permission_preset_levels
where preset_key = 'office'
on conflict (preset_key, page_key) do nothing;

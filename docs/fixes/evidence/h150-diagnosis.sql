-- Diagnóstico H-150. Sólo lectura; nunca ejecuta una limpieza ni decide cuarentena.
begin read only;
select device_id, queue_pending, queue_blocked, client_build, last_seen_at
from pos.sync_devices where device_id = 'dev-ms0nu9o4-yfeifbb1';
select domain, operation_type, status, count(*)
from pos.sync_quarantine_cases where device_id = 'dev-ms0nu9o4-yfeifbb1'
group by domain, operation_type, status order by domain, operation_type;
select s as selection, (r->'fleet'->'summary') as fleet_summary,
  (select jsonb_agg(jsonb_build_object(
    'device_id', e->>'device_id', 'code', e->>'code',
    'conflict_count', jsonb_array_length(e->'operations'),
    'first_conflict', e->'operations'->0))
   from jsonb_array_elements(r->'blocked_reasons') e) as blockers
from (select s, pos.test_data_cleanup_fleet_risk(jsonb_build_object(
  'selection_normalized', s, 'blocked_reasons', '[]'::jsonb)) r
  from (values ('{}'::jsonb), ('{"sales":true}'::jsonb),
    ('{"returns":true}'::jsonb), ('{"reclassifications":true}'::jsonb)) a(s)) b;
commit;

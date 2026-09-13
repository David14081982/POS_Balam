-- H171 read-only inspection of the DEVICE_RETIRED rejection.
-- No fence call, bypass flag, device update, credential read or DELETE.
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
SET LOCAL TimeZone='UTC';
SELECT jsonb_build_object(
 'audit','H171 retirement fence inspection','read_only',current_setting('transaction_read_only'),
 'current_user',current_user,'session_user',session_user,'role',current_setting('role',true),
 'auth_uid_is_null',auth.uid() IS NULL,
 'has_request_device_header',(coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}')->>'x-balam-device-id') IS NOT NULL,
 'h149_rpc',current_setting('pos.h149_rpc',true),
 'functions',(SELECT jsonb_agg(jsonb_build_object(
   'function',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),
   'definition_md5',md5(pg_get_functiondef(p.oid))) ORDER BY p.oid::regprocedure::text)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='pos' AND p.proname IN(
   'assert_device_recovery_write','guard_device_recovery_row','guard_online_commercial_write',
   'online_request_context','assert_online_device','test_data_cleanup_selection')),
 'qa_product_origins',(SELECT jsonb_agg(jsonb_build_object('product_id',p.id,
   'origin_device_id',p.sync_device_id,'origin_status',d.status,
   'row_md5',md5(to_jsonb(p)::text),'deleted',p.deleted_at IS NOT NULL) ORDER BY p.id)
  FROM pos.products p LEFT JOIN pos.sync_devices d ON d.device_id=p.sync_device_id
  WHERE p.id=ANY(ARRAY['07e7f317-807e-4382-abd3-517f2f109484','0abfa7f5-6d8c-4edf-bfc8-0a7e87b0df03','0fca850b-087c-481c-ac05-17e9e058bb7c','1c329b33-1478-4316-83b2-0c96b73d386f','3804757b-5bda-404b-8c39-f215b21f2d43','49d6e6ba-3054-48e3-942d-fd2c6a5678cb','6a6375de-ecbf-4824-a062-907c838c36e4','6cf88a71-9c31-42f1-a446-cc4e27b8ac29','81e59ebd-fa9d-41f7-81ee-af0a722b9fab','82b8863c-89dd-47be-8b4b-e81c66e202e3','a7e2bc67-2f72-4e1f-90b2-e72acb8fd7be','c5a3b49d-f94c-423b-84e1-d02a8d97c4c0','cf187ffb-b033-4c09-a669-8f5a8fdf84fb','eb82cb4c-16c3-4c3c-9662-06323693df84']::text[])),
 'rpc_context_callers',(SELECT jsonb_agg(jsonb_build_object('function',p.oid::regprocedure::text,
   'has_device_assert',position('assert_device_recovery_write' IN p.prosrc)>0,
   'security_definer',p.prosecdef) ORDER BY p.oid::regprocedure::text)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='pos' AND position('set_config(''pos.h149_rpc''' IN p.prosrc)>0),
 'maintenance_named_functions',(SELECT coalesce(jsonb_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text),'[]'::jsonb)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='pos' AND p.proname ~ '(maintenance|maintainer|mantenimiento)')
) AS report;
COMMIT;

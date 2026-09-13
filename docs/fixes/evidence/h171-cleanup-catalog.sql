-- H171: obtain actual deletion fences and their dependencies before drafting cleanup.
-- Read only; no application functions are invoked.
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
WITH target AS (
 SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='pos' AND c.relkind IN('r','p')
), trigger_functions AS (
 SELECT DISTINCT t.tgfoid AS oid FROM pg_trigger t JOIN target ON target.oid=t.tgrelid WHERE NOT t.tgisinternal
), helpers AS (
 SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='pos' AND p.proname IN(
  'online_request_context','guard_device_recovery_row','bump_sync_domain',
  'assert_permission_admin_survives','assert_permission_admin_survives_scope',
  'can_manage_screen_permissions','h166_advance_snapshot_revision')
)
SELECT jsonb_build_object(
 'audit','H171 cleanup trigger catalog','read_only',current_setting('transaction_read_only'),
 'generated_at',clock_timestamp(),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object(
  'table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,
  'delete_event',(t.tgtype::integer&8)<>0,'definition',pg_get_triggerdef(t.oid,true),
  'function',t.tgfoid::regprocedure::text) ORDER BY t.tgrelid::regclass::text,t.tgname),'[]'::jsonb)
  FROM pg_trigger t JOIN target ON target.oid=t.tgrelid WHERE NOT t.tgisinternal),
 'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object(
  'function',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),
  'definition_md5',md5(pg_get_functiondef(p.oid))) ORDER BY p.oid::regprocedure::text),'[]'::jsonb)
  FROM pg_proc p WHERE p.oid IN(SELECT oid FROM trigger_functions UNION SELECT oid FROM helpers)),
 'primary_keys',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,
  'definition',pg_get_constraintdef(c.oid,true)) ORDER BY c.conrelid::regclass::text),'[]'::jsonb)
  FROM pg_constraint c JOIN target ON target.oid=c.conrelid WHERE c.contype='p'),
 'current_user',current_user,'session_user',session_user,'role',current_setting('role',true)
) AS report;
COMMIT;

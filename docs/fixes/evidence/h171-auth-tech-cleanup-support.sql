-- H171 support for the proposed technical cleanup. READ ONLY.
-- Obtain live permission resolvers to test the existing last-admin fence locally.
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
SET LOCAL TimeZone='UTC';
SELECT jsonb_build_object(
 'audit','H171 technical cleanup live support catalogue',
 'read_only',current_setting('transaction_read_only'),
 'functions',(SELECT jsonb_agg(jsonb_build_object(
   'function',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),
   'definition_md5',md5(pg_get_functiondef(p.oid))) ORDER BY p.oid::regprocedure::text)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='pos' AND p.proname IN(
    'resolve_screen_permission','resolve_screen_permission_precedence','resolve_operational_capability',
    'assert_permission_admin_survives','assert_permission_admin_survives_scope',
    'can_manage_screen_permissions','enforce_permission_admin_survives',
    'guard_online_commercial_write','online_request_context','h166_advance_snapshot_revision',
    'is_active_admin','is_active_seller','role_for_user')),
 'checks',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,
   'name',c.conname,'definition',pg_get_constraintdef(c.oid,true))),'[]'::jsonb)
   FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
   WHERE n.nspname='pos' AND c.contype='c' AND c.conrelid IN(
    'pos.capability_operation_audit'::regclass,'pos.config_commits'::regclass,
    'pos.online_account_requests'::regclass,'pos.online_requests'::regclass,
    'pos.permission_change_audit'::regclass,'pos.sync_activity'::regclass,
    'pos.sync_devices'::regclass,'pos.sync_quarantine_cases'::regclass,
    'pos.user_permission_role_assignments'::regclass)),
 'permission_catalogue',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY capability_key),'[]'::jsonb)
    FROM pos.operational_capabilities t),
 'protected_real_actor_present',EXISTS(SELECT 1 FROM auth.users
   WHERE id='3f24222e-fd74-4ed2-b56f-f298af574b1e'),
 'protected_real_actor_permission_guard',pos.can_manage_screen_permissions(
    '3f24222e-fd74-4ed2-b56f-f298af574b1e'::uuid)
) AS report;
COMMIT;

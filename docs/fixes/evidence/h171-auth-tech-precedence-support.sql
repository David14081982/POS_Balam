-- H171: one transitive dependency found in the live screen resolver.
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT jsonb_build_object('read_only',current_setting('transaction_read_only'),
 'functions',(SELECT jsonb_agg(jsonb_build_object(
 'function',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),
 'definition_md5',md5(pg_get_functiondef(p.oid))))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='pos' AND p.proname='resolve_screen_permission_precedence')) AS report;
COMMIT;

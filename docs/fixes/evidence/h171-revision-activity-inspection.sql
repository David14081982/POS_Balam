-- H171 BALAM READ ONLY. No query text, literals, credentials or client IPs exported.
-- Aggregate statistics can identify classes of writes, not prove the +7 caller.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL TimeZone='UTC';
DO $h171_revision_statistics$
DECLARE stat_schema text; stats jsonb:='[]'::jsonb; status text:='not_installed';
BEGIN
 SELECT n.nspname INTO stat_schema FROM pg_extension e
 JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_stat_statements';
 IF stat_schema IS NOT NULL AND to_regclass(format('%I.pg_stat_statements',stat_schema)) IS NOT NULL THEN
  BEGIN
   EXECUTE format($q$
    SELECT coalesce(jsonb_agg(x ORDER BY (x->>'calls')::bigint DESC),'[]'::jsonb)
    FROM (
     SELECT jsonb_build_object(
      'query_id',s.queryid::text,'query_md5',md5(s.query),
      'database_id',s.dbid,'role_id',s.userid,'calls',s.calls,'rows',s.rows,
      'total_exec_time_ms',to_jsonb(s)->'total_exec_time',
      'stats_since',to_jsonb(s)->'stats_since',
      'mentions_snapshot_revision',s.query ILIKE '%%online_snapshot_revision%%',
      'mentions_h166_trigger',s.query ILIKE '%%h166_advance_snapshot_revision%%',
      'has_update_keyword',s.query ~* '\mupdate\M',
      'has_insert_keyword',s.query ~* '\minsert\M',
      'has_delete_keyword',s.query ~* '\mdelete\M',
      'has_truncate_keyword',s.query ~* '\mtruncate\M',
      'mentions_online_command',s.query ~* 'pos\.online_command',
      'mentions_qa_cleanup',s.query ~* 'h171t_removed|h171_deleted'
     ) AS x
     FROM %I.pg_stat_statements s
     WHERE s.dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
      AND (s.query ~* 'online_snapshot_revision|h166_advance_snapshot_revision'
       OR (s.query ~* '\m(update|insert|delete|truncate)\M' AND s.query ~* 'pos\.'))
      AND s.query NOT ILIKE '%%h171_revision_statistics%%'
     ORDER BY s.calls DESC LIMIT 60
    ) safe
   $q$,stat_schema) INTO stats;
   status:='available';
  EXCEPTION WHEN insufficient_privilege THEN status:='insufficient_privilege';
   WHEN undefined_column THEN status:='unsupported_statistics_columns';
   WHEN object_not_in_prerequisite_state THEN status:='not_preloaded';
  END;
 END IF;
 PERFORM set_config('h171.revision_stats',jsonb_build_object('status',status,'safe_entries',stats)::text,true);
END $h171_revision_statistics$;
SELECT jsonb_build_object(
 'audit','H171 BALAM revision activity inspection, no raw SQL',
 'project_ref','telohdbvbvsfmwyriflz','read_only',current_setting('transaction_read_only'),
 'at',clock_timestamp(),'revision',(SELECT revision FROM pos.online_snapshot_revision WHERE singleton),
 'statistics',current_setting('h171.revision_stats')::jsonb,
 'current_backends',(SELECT coalesce(jsonb_agg(jsonb_build_object(
  'backend_type',a.backend_type,'state',a.state,'role_name',a.usename,
  'transaction_started_at',a.xact_start,'query_started_at',a.query_start,
  'state_changed_at',a.state_change,'wait_event_type',a.wait_event_type,
  'query_md5',md5(a.query),'query_visible',a.query IS NOT NULL AND a.query<>'<insufficient privilege>',
  'mentions_snapshot_revision',a.query ILIKE '%online_snapshot_revision%',
  'has_write_keyword',a.query ~* '\m(update|insert|delete|truncate)\M'
 ) ORDER BY a.query_start),'[]'::jsonb) FROM pg_stat_activity a
 WHERE a.datname=current_database() AND a.pid<>pg_backend_pid()),
 'limitations',jsonb_build_array(
  'pg_stat_statements aggregates since its last reset; it does not identify the time or actor of exactly seven revisions.',
  'pg_stat_activity is current state, not historical audit. A completed writer can be absent.',
  'Row statement triggers increment revision even when zero rows are affected. No raw SQL or client addresses are exported.'
 )
) AS report;
COMMIT;

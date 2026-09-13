-- H171 READ ONLY size inspection. No historical payload or credentials exported.
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL TimeZone='UTC';
SELECT jsonb_build_object(
 'audit','H171 point_zero_backups hash cost inspection','read_only',current_setting('transaction_read_only'),
 'at',clock_timestamp(),
 'table_bytes',pg_total_relation_size('pos.point_zero_backups'),
 'rows',(SELECT jsonb_agg(jsonb_build_object('backup_id',backup_id,
  'payload_stored_bytes',pg_column_size(payload),'counts_stored_bytes',pg_column_size(counts),
  'created_at',created_at) ORDER BY backup_id) FROM pos.point_zero_backups),
 'table_stats',(SELECT jsonb_build_object('live_rows_estimate',n_live_tup,'dead_rows_estimate',n_dead_tup,
  'sequential_scans',seq_scan,'sequential_tuples_read',seq_tup_read) FROM pg_stat_user_tables
  WHERE schemaname='pos' AND relname='point_zero_backups'),
 'limits',jsonb_build_array('Stored/compressed bytes do not measure fully expanded JSON size.','Inspection does not run DELETE or rewrite history.')
) AS report;
COMMIT;

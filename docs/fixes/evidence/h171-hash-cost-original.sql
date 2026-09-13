-- H171 READ ONLY original-form benchmark, separate so timeout cannot hide candidate output.
BEGIN READ ONLY;
SET LOCAL statement_timeout='60s';
SET LOCAL TimeZone='UTC';
SET LOCAL DateStyle='ISO, MDY';
WITH started AS MATERIALIZED(SELECT clock_timestamp() AS at), aggregate AS (
 SELECT count(*) AS rows,
 md5(coalesce(string_agg(md5((to_jsonb(t)-ARRAY['preview_token'])::text),'' ORDER BY (to_jsonb(t)-ARRAY['preview_token'])::text),'')) AS projected_rows_md5
 FROM pos.point_zero_backups t CROSS JOIN started
)
SELECT jsonb_build_object('audit','H171 original point_zero hash benchmark',
 'read_only',current_setting('transaction_read_only'),'algorithm','md5-of-projected-row-md5-sorted-by-json-v1',
 'rows',a.rows,'projected_rows_md5',a.projected_rows_md5,
 'elapsed_ms',extract(epoch FROM clock_timestamp()-s.at)*1000)
 AS report FROM aggregate a CROSS JOIN started s;
COMMIT;

-- H171 READ ONLY candidate benchmark: materialize each row digest once.
-- Output is only counts, fingerprints and elapsed time; no payloads or secrets.
BEGIN READ ONLY;
SET LOCAL statement_timeout='60s';
SET LOCAL TimeZone='UTC';
SET LOCAL DateStyle='ISO, MDY';
WITH started AS MATERIALIZED(SELECT clock_timestamp() AS at),
fingerprints AS MATERIALIZED(
 SELECT md5((to_jsonb(t)-ARRAY['preview_token'])::text) AS row_md5
 FROM pos.point_zero_backups t CROSS JOIN started
), aggregate AS (
 SELECT count(*) AS rows,md5(coalesce(string_agg(row_md5,'' ORDER BY row_md5),'')) AS projected_rows_md5
 FROM fingerprints
)
SELECT jsonb_build_object('audit','H171 candidate point_zero hash benchmark',
 'read_only',current_setting('transaction_read_only'),'algorithm','md5-of-sorted-projected-row-md5-v1',
 'rows',a.rows,'projected_rows_md5',a.projected_rows_md5,
 'elapsed_ms',extract(epoch FROM clock_timestamp()-s.at)*1000)
 AS report FROM aggregate a CROSS JOIN started s;
COMMIT;

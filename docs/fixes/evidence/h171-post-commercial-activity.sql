-- H171: READ ONLY reconciliation of the revision observed after COMMIT.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TimeZone='UTC';
SELECT jsonb_build_object(
 'readOnly',true,'at',clock_timestamp(),
 'revision',(SELECT to_jsonb(t) FROM pos.online_snapshot_revision t),
 'recentRequests',(SELECT coalesce(jsonb_agg(jsonb_build_object('actorId',t.actor_id,'requestId',t.request_id,'kind',t.command_kind,'state',t.state,'createdAt',t.created_at,'completedAt',t.completed_at) ORDER BY t.created_at),'[]'::jsonb) FROM pos.online_requests t WHERE t.created_at>='2026-09-13T04:00:00Z'),
 'recentAccountRequests',(SELECT coalesce(jsonb_agg(to_jsonb(t)-ARRAY['payload','response']),'[]'::jsonb) FROM pos.online_account_requests t WHERE t.created_at>='2026-09-13T04:00:00Z'),
 'snapshotFunction',pg_get_functiondef('pos.h166_advance_snapshot_revision()'::regprocedure),
 'onlyOnline',(SELECT enabled FROM pos.online_runtime WHERE singleton)
) AS report;
COMMIT;

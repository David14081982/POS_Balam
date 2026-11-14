-- Private rollback evidence; retain locally, never publish the output.
begin read only;
select jsonb_build_object(
 'at',statement_timestamp(),
 'overrides',(select coalesce(jsonb_agg(to_jsonb(o) order by user_id,capability_key),'[]') from pos.user_capability_overrides o),
 'revision',(select revision from pos.online_snapshot_revision where singleton)
) evidence;
commit;

-- H166: a transaction revision for conditional authoritative reads, not a queue/cursor.
begin;
create table pos.online_snapshot_revision (
 singleton boolean primary key default true check(singleton),
 revision bigint not null default 1 check(revision>0)
);
insert into pos.online_snapshot_revision(singleton) values(true);
alter table pos.online_snapshot_revision enable row level security;
revoke all on pos.online_snapshot_revision from public,anon,authenticated;
grant select on pos.online_snapshot_revision to authenticated;
grant all on pos.online_snapshot_revision to service_role;
create policy online_revision_read on pos.online_snapshot_revision for select to authenticated
 using(auth.uid() is not null and (pos.is_active_admin() or pos.is_active_seller()));

create function pos.h166_advance_snapshot_revision() returns trigger
language plpgsql security definer set search_path=pg_catalog,pos as $$
begin
 update pos.online_snapshot_revision set revision=revision+1 where singleton;
 return null;
end $$;
revoke all on function pos.h166_advance_snapshot_revision() from public,anon,authenticated;

-- Include every snapshot/quote/permission dependency. Presence and receipts do
-- not alter a commercial snapshot and intentionally do not invalidate it.
do $triggers$
declare relation text;
begin
 foreach relation in array array[
 'products','clients','sellers','promotions','sales','sale_items','sale_payments',
 'returns','return_items','exchanges','exchange_items','loan_documents','movements',
 'liquidations','commission_adjustments','lookup','settings','config_sync_state',
 'stock_reservations','reference_reclassifications','online_legacy_operations',
 'permission_roles','user_permission_role_assignments','role_screen_permissions',
 'user_screen_permission_overrides','role_capability_permissions',
 'screen_permission_catalog','screen_permission_catalog_state','online_runtime'
 ] loop
  execute format('create trigger h166_snapshot_changed after insert or update or delete or truncate on pos.%I for each statement execute function pos.h166_advance_snapshot_revision()',relation);
 end loop;
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table pos.online_snapshot_revision;
 end if;
end $triggers$;

create function pos.online_snapshot_if_changed(p_revision text default null) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,pos,auth as $$
declare revision_token text; counter bigint;
 quote_at timestamp:=statement_timestamp() at time zone 'America/Hermosillo';
begin
 if auth.uid() is null or not(pos.is_active_admin() or pos.is_active_seller()) then
  raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501';
 end if;
 select revision into strict counter from pos.online_snapshot_revision where singleton;
 -- Exact token, including actor, device, business day and timed promotion phase.
 -- The stable function and nested online_snapshot share the same MVCC snapshot.
 revision_token:=jsonb_build_array(counter::text,auth.uid(),
  (coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-device-id',
  quote_at::date,(select coalesce(jsonb_agg(jsonb_build_array(id,
   case when pausado then 'Pausado'
    when inicio is not null and quote_at<inicio+coalesce(nullif(hora_inicio,''),'00:00')::time then 'Programado'
    when fin is not null and quote_at>fin+coalesce(nullif(hora_fin,''),'23:59')::time then 'Finalizado'
    else 'Activo' end) order by id),'[]') from pos.promotions where deleted_at is null))::text;
 if p_revision is not null and p_revision=revision_token then
  return jsonb_build_object('snapshotRevision',revision_token,'unchanged',true,'serverTime',statement_timestamp());
 end if;
 return pos.online_snapshot()||jsonb_build_object('snapshotRevision',revision_token,'unchanged',false);
end $$;
revoke all on function pos.online_snapshot_if_changed(text) from public,anon,authenticated;
grant execute on function pos.online_snapshot_if_changed(text) to authenticated;
comment on table pos.online_snapshot_revision is 'H166 online invalidation metadata only. No business payload, cursor adoption, replay, or local authority.';
notify pgrst,'reload schema';
commit;

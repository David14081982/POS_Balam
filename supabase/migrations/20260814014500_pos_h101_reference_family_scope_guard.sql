-- H-101: endurece la frontera del lote familiar sin modificar datos.
begin;

alter function pos.commit_reference_family_batch(uuid,uuid,jsonb,integer,bigint)
  rename to commit_reference_family_batch_h101_internal;

revoke all on function pos.commit_reference_family_batch_h101_internal(uuid,uuid,jsonb,integer,bigint)
  from public, anon, authenticated;

create function pos.commit_reference_family_batch(
  p_operation_id uuid,
  p_reference_family_id uuid,
  p_rows jsonb,
  p_protocol_version integer,
  p_data_epoch bigint
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pos as $$
begin
  if p_operation_id is null or p_reference_family_id is null
     or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'INVALID_REFERENCE_FAMILY_BATCH' using errcode='22023';
  end if;

  -- Un ID ya persistido sólo puede editarse dentro de su familia V2 actual.
  -- Los IDs nuevos no hacen match y pueden nacer en la familia solicitada.
  if exists (
    select 1
      from jsonb_array_elements(p_rows) r
      join pos.products p on p.id = r->>'id'
     where p.record_model <> 'v2'
        or p.reference_family_id is distinct from p_reference_family_id
  ) then
    raise exception 'REFERENCE_FAMILY_EXISTING_SCOPE_MISMATCH' using errcode='22023';
  end if;

  return pos.commit_reference_family_batch_h101_internal(
    p_operation_id, p_reference_family_id, p_rows,
    p_protocol_version, p_data_epoch
  );
end;
$$;

revoke all on function pos.commit_reference_family_batch(uuid,uuid,jsonb,integer,bigint)
  from public, anon;
grant execute on function pos.commit_reference_family_batch(uuid,uuid,jsonb,integer,bigint)
  to authenticated;

update pos.system_manifest
set schema_version=greatest(schema_version,20260814014500),updated_at=now()
where singleton;

commit;

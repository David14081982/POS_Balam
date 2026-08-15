-- H-101: verificación del límite V1/familia sin fixtures ni escrituras.
do $$
declare
  v_wrapper text;
begin
  v_wrapper := pg_get_functiondef(
    'pos.commit_reference_family_batch(uuid,uuid,jsonb,integer,bigint)'::regprocedure
  );
  if position('REFERENCE_FAMILY_EXISTING_SCOPE_MISMATCH' in v_wrapper)=0
     or position('p.record_model <> ''v2''' in v_wrapper)=0
     or position('p.reference_family_id is distinct from p_reference_family_id' in v_wrapper)=0 then
    raise exception 'H101_EXISTING_FAMILY_SCOPE_GUARD_MISSING';
  end if;
  if has_function_privilege(
    'authenticated',
    'pos.commit_reference_family_batch_h101_internal(uuid,uuid,jsonb,integer,bigint)',
    'execute'
  ) then
    raise exception 'H101_INTERNAL_BATCH_RPC_EXPOSED';
  end if;
  if exists(select 1 from pos.products
      where record_model='v1' and reference_family_id is not null) then
    raise exception 'H101_V1_FAMILY_CONTAMINATION';
  end if;
end $$;

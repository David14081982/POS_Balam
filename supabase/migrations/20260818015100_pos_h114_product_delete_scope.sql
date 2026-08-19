-- H-114 · Baja exacta y atómica de referencias V1/V2.
-- Conserva los documentos históricos: sólo crea tombstones en pos.products.
begin;

create or replace function pos.delete_products_checked_v2(
  p_operation_id uuid,
  p_scope text,
  p_reference_family_id uuid,
  p_targets jsonb,
  p_device_id text,
  p_protocol_version integer,
  p_data_epoch bigint
) returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_ids text[];
  v_count integer;
  v_hash text;
  v_result jsonb;
begin
  perform pos.require_current_capability('inventory.delete');
  perform pos.assert_sync_write_context(p_protocol_version,p_data_epoch);
  if p_operation_id is null or p_scope is null or p_scope not in ('reference','family')
     or jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets)=0
     or nullif(trim(coalesce(p_device_id,'')),'') is null then
    raise exception 'INVALID_INVENTORY_DELETE_SCOPE' using errcode='22023';
  end if;

  select array_agg(t.id order by t.id),count(*) into v_ids,v_count
  from (
    select nullif(trim(x->>'id'),'') id
    from jsonb_array_elements(p_targets) x
  ) t;
  if v_ids is null or array_position(v_ids,null) is not null
     or v_count <> (select count(distinct x->>'id') from jsonb_array_elements(p_targets) x)
     or exists(select 1 from jsonb_array_elements(p_targets) x
               where coalesce(x->>'baseVersion',x->>'base_version') is null) then
    raise exception 'INVALID_INVENTORY_DELETE_TARGETS' using errcode='22023';
  end if;

  v_hash := md5(jsonb_build_array(p_scope,p_reference_family_id,p_targets,p_device_id,
                                   p_protocol_version,p_data_epoch)::text);
  perform pg_advisory_xact_lock(hashtext(coalesce(p_reference_family_id::text,p_operation_id::text)));
  select result into v_result from pos.capability_operation_audit
   where operation_id=p_operation_id and capability_key='inventory.delete' and payload_hash=v_hash;
  if found then return v_result; end if;
  if exists(select 1 from pos.capability_operation_audit where operation_id=p_operation_id) then
    raise exception 'INVENTORY_OPERATION_CONFLICT' using errcode='40001';
  end if;

  perform 1 from pos.products p where p.id=any(v_ids) for update;
  if (select count(*) from pos.products p where p.id=any(v_ids) and p.deleted_at is null) <> v_count then
    raise exception 'PRODUCT_NOT_FOUND' using errcode='P0002';
  end if;
  if exists(
    select 1 from pos.products p
    join jsonb_array_elements(p_targets) x on x->>'id'=p.id
    where p.sync_version <> coalesce(x->>'baseVersion',x->>'base_version')::bigint
  ) then raise exception 'PRODUCT_VERSION_CONFLICT' using errcode='40001'; end if;

  if p_scope='reference' then
    if v_count<>1 or (p_reference_family_id is not null and exists(
      select 1 from pos.products p where p.id=any(v_ids)
       and p.reference_family_id is distinct from p_reference_family_id
    )) then raise exception 'REFERENCE_FAMILY_SCOPE_MISMATCH' using errcode='22023'; end if;
  else
    if p_reference_family_id is null
       or exists(select 1 from pos.products p where p.id=any(v_ids)
                 and (p.record_model<>'v2' or p.reference_family_id is distinct from p_reference_family_id))
       or exists(select 1 from pos.products p where p.deleted_at is null
                 and p.record_model='v2' and p.reference_family_id=p_reference_family_id
                 and not(p.id=any(v_ids))) then
      raise exception 'REFERENCE_FAMILY_SCOPE_MISMATCH' using errcode='22023';
    end if;
  end if;

  if exists(
    select 1 from pos.sales s join pos.sale_items i on i.folio=s.folio
     where i.product_id=any(v_ids) and s.estado='Apartado'
  ) then raise exception 'PRODUCT_ACTIVE_LAYAWAY' using errcode='23514'; end if;

  if exists(
    select 1 from pos.loan_documents l
    cross join lateral jsonb_array_elements(coalesce(l.document->'lineas','[]'::jsonb)) line
    where l.deleted_at is null and l.state='pendiente'
      and coalesce(line->>'productId',line->>'product_id')=any(v_ids)
      and greatest(0,coalesce((line->>'qty')::integer,0)-coalesce((line->>'devueltas')::integer,0))>0
  ) then raise exception 'PRODUCT_OPEN_LOAN' using errcode='23514'; end if;

  -- La identidad posventa es line_id/source_sale_line_id (H-94), nunca SKU.
  if exists(
    with eligible_sales as (
      select s.folio from pos.sales s
       where s.estado in('Pagado','Entregado','Enviado','Devolución parcial')
         and (s.return_limit_days is null or s.return_expires_at is null or s.return_expires_at>=current_date)
    ), supplied as (
      select si.folio,si.line_id,si.product_id,si.qty
        from pos.sale_items si join eligible_sales s on s.folio=si.folio
       where si.product_id=any(v_ids)
      union all
      select e.origen_folio,ei.line_id,ei.product_id,ei.qty
        from pos.exchange_items ei join pos.exchanges e on e.id=ei.exchange_id
        join eligible_sales s on s.folio=e.origen_folio
       where ei.lado='entregado' and ei.product_id=any(v_ids)
    )
    select 1 from supplied src
     where src.line_id is not null and src.qty >
       coalesce((select sum(ri.qty) from pos.return_items ri
                 where ri.source_sale_line_id=src.line_id and ri.product_id=src.product_id),0)
       + coalesce((select sum(ei.qty) from pos.exchange_items ei
                   where ei.lado='devuelto' and ei.source_sale_line_id=src.line_id
                     and ei.product_id=src.product_id),0)
  ) then raise exception 'PRODUCT_RETURNABLE_HISTORY' using errcode='23514'; end if;

  with requested as (
    select x->>'id' id,coalesce(x->>'baseVersion',x->>'base_version')::bigint base_version
      from jsonb_array_elements(p_targets) x
  ), updated as (
    update pos.products p set deleted_at=now(),sync_base_version=requested.base_version,
      sync_device_id=p_device_id from requested
     where p.id=requested.id and p.deleted_at is null returning p.*
  ) select jsonb_build_object('ok',true,'scope',p_scope,
      'rows',coalesce(jsonb_agg(to_jsonb(updated) order by updated.id),'[]'::jsonb))
    into v_result from updated;
  insert into pos.capability_operation_audit(
    operation_id,capability_key,actor_user_id,subject_key,payload_hash,result
  ) values(p_operation_id,'inventory.delete',v_actor,
           coalesce(p_reference_family_id::text,v_ids[1]),v_hash,v_result);
  return v_result;
end;
$$;

-- El contrato V1/V2 individual sigue teniendo una sola autoridad.
create or replace function pos.delete_product_checked_v2(
  p_operation_id uuid,p_id text,p_base_version bigint,p_device_id text,
  p_protocol_version integer,p_data_epoch bigint
) returns jsonb language plpgsql security definer set search_path=pos,pg_temp as $$
declare v_family uuid; v_result jsonb;
begin
  select reference_family_id into v_family from pos.products where id=p_id;
  v_result := pos.delete_products_checked_v2(
    p_operation_id,'reference',v_family,
    jsonb_build_array(jsonb_build_object('id',p_id,'baseVersion',coalesce(p_base_version,0))),
    p_device_id,p_protocol_version,p_data_epoch
  );
  return v_result->'rows'->0;
end;
$$;

revoke all on function pos.delete_products_checked_v2(uuid,text,uuid,jsonb,text,integer,bigint) from public,anon;
revoke all on function pos.delete_product_checked_v2(uuid,text,bigint,text,integer,bigint) from public,anon;
grant execute on function pos.delete_products_checked_v2(uuid,text,uuid,jsonb,text,integer,bigint) to authenticated;
grant execute on function pos.delete_product_checked_v2(uuid,text,bigint,text,integer,bigint) to authenticated;

commit;

-- H149: only control-plane state; no commercial backfill or global epoch change.
begin;
create table pos.sync_device_recoveries (
 device_id text primary key references pos.sync_devices(device_id),
 id uuid not null unique default gen_random_uuid(),
 owner_id uuid not null,
 expected_count integer not null check(expected_count between 1 and 10000),
 source_epoch bigint not null,
 protocol_version integer not null,
 minimum_build text not null,
 candidate_ids text[] not null check(cardinality(candidate_ids)>=expected_count),
 state text not null default 'pending' check(state in ('pending','captured','completed')),
 evidence jsonb,
 discarded_ids text[],
 write_token uuid not null default gen_random_uuid(),
 created_at timestamptz not null default now(),
 created_by uuid,
 authorization_reason text not null,
 completed_at timestamptz,
 receipt jsonb,
 check ((state='pending' and evidence is null and discarded_ids is null)
     or (state in ('captured','completed') and evidence is not null
         and cardinality(discarded_ids)=expected_count)),
 check ((state='completed')=(completed_at is not null))
);
alter table pos.sync_device_recoveries enable row level security;
revoke all on pos.sync_device_recoveries from public,anon,authenticated;
grant select(device_id,id,expected_count,source_epoch,protocol_version,minimum_build,state,
 created_at,completed_at) on pos.sync_device_recoveries to authenticated;
grant all on pos.sync_device_recoveries to service_role;
create policy recovery_admin_read on pos.sync_device_recoveries for select to authenticated
 using(pos.is_active_admin());

-- Internal entry guard, before any legacy idempotent ACK or commercial mutation.
create function pos.assert_device_recovery_write(p_device_id text, p_operation_ids text[])
returns void language plpgsql security definer set search_path=pg_catalog,pos as $function$
declare r pos.sync_device_recoveries%rowtype;
 h jsonb := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
 d text := coalesce(nullif(p_device_id,''),h->>'x-balam-device-id');
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('pos.h149.recovery-fence',0));
 for r in select * from pos.sync_device_recoveries
  where device_id=d or candidate_ids && coalesce(p_operation_ids,'{}'::text[])
  order by device_id for share
 loop
  if r.candidate_ids && coalesce(p_operation_ids,'{}'::text[]) then
   raise exception using errcode='P0001',message='BALAM necesita actualizarse antes de continuar.',
    detail='TEST_PENDING_DISCARDED';
  end if;
  if r.state<>'completed' or h->>'x-balam-recovery-token' is distinct from r.write_token::text then
   raise exception using errcode='P0001',message='BALAM necesita actualizarse antes de continuar.',
    detail='DEVICE_RECOVERY_REQUIRED';
  end if;
 end loop;
end $function$;
revoke all on function pos.assert_device_recovery_write(text,text[]) from public,anon,authenticated;
grant execute on function pos.assert_device_recovery_write(text,text[]) to service_role;

create function pos.guard_device_recovery_row() returns trigger
language plpgsql security definer set search_path=pg_catalog,pos as $function$
declare j jsonb; d text;
 h jsonb := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
begin
 if TG_OP='DELETE' then j:=to_jsonb(OLD); else j:=to_jsonb(NEW); end if;
 -- A stored origin is not the identity of a later financial transaction.
 d:=h->>'x-balam-device-id';
 if coalesce(current_setting('pos.h149_rpc',true),'')<>'on' and d is null then
  d:=coalesce(j->>'sync_device_id',j->>'device_id');
 end if;
 perform pos.assert_device_recovery_write(d,array[j->>'operation_id',j->>'commit_id']);
 if TG_OP='DELETE' then return OLD; end if;
 return NEW;
end $function$;
revoke all on function pos.guard_device_recovery_row() from public,anon,authenticated;
grant execute on function pos.guard_device_recovery_row() to service_role;

create function pos.get_sync_device_recovery(p_device_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos as $function$
declare r pos.sync_device_recoveries%rowtype;
begin
 if auth.uid() is null or not (pos.is_active_admin() or pos.is_active_seller()) then
  raise exception using errcode='42501',message='active_profile_required';
 end if;
 select * into r from pos.sync_device_recoveries where device_id=p_device_id;
 if not found then return null; end if;
 if r.owner_id<>auth.uid() then
  raise exception using errcode='42501',message='recovery_owner_required';
 end if;
 return jsonb_build_object('id',r.id,'device_id',r.device_id,'state',r.state,
  'expected_count',r.expected_count,'source_epoch',r.source_epoch,
  'protocol_version',r.protocol_version,'minimum_build',r.minimum_build,
  'candidate_ids',r.candidate_ids,'discarded_ids',r.discarded_ids,'evidence',r.evidence,
  'write_token',case when r.state='completed' then r.write_token else null end);
end $function$;

create function pos.capture_sync_device_recovery(p_device_id text,p_recovery_id uuid,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pos as $function$
declare r pos.sync_device_recoveries%rowtype; ids text[]; clean jsonb;
begin
 perform pos.get_sync_device_recovery(p_device_id);
 select * into strict r from pos.sync_device_recoveries where device_id=p_device_id for update;
 if r.id<>p_recovery_id then raise exception 'RECOVERY_ID_MISMATCH'; end if;
 if r.state='completed' then return pos.get_sync_device_recovery(p_device_id); end if;
 if coalesce(p_evidence->>'build','') < r.minimum_build
  or coalesce((p_evidence->>'protocol')::integer,0)<>r.protocol_version
  or coalesce((p_evidence->>'epoch')::bigint,0)<>r.source_epoch
  or coalesce(p_evidence->>'queue_hash','') !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p_evidence->'operations') is distinct from 'array' then
  raise exception 'RECOVERY_EVIDENCE_INVALID';
 end if;
 select array_agg(x->>'id' order by x->>'id'),jsonb_agg(jsonb_build_object(
  'id',x->>'id','type',left(x->>'type',60),'epoch',(x->>'epoch')::bigint,
  'protocol',(x->>'protocol')::integer) order by x->>'id') into ids,clean
 from jsonb_array_elements(p_evidence->'operations') x;
 if cardinality(ids) is distinct from r.expected_count or not ids <@ r.candidate_ids
  or (select count(distinct x) from unnest(ids) x)<>r.expected_count
  or exists(select 1 from jsonb_array_elements(clean) x where
   (x->>'epoch')::bigint is distinct from r.source_epoch
   or (x->>'protocol')::integer is distinct from r.protocol_version) then
  raise exception 'RECOVERY_SCOPE_MISMATCH';
 end if;
 clean:=jsonb_build_object('build',p_evidence->>'build','protocol',r.protocol_version,
  'epoch',r.source_epoch,'queue_hash',p_evidence->>'queue_hash','operations',clean);
 if r.state='captured' then
  if r.evidence<>clean then raise exception 'RECOVERY_CAPTURE_MISMATCH'; end if;
 else
  update pos.sync_device_recoveries set state='captured',evidence=clean,discarded_ids=ids
   where device_id=p_device_id;
 end if;
 return pos.get_sync_device_recovery(p_device_id);
end $function$;

create function pos.complete_sync_device_recovery(p_device_id text,p_recovery_id uuid,
 p_cursors jsonb,p_epoch bigint,p_protocol integer,p_pending integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos as $function$
declare r pos.sync_device_recoveries%rowtype; m pos.system_manifest%rowtype;
begin
 perform pos.get_sync_device_recovery(p_device_id);
 select * into strict r from pos.sync_device_recoveries where device_id=p_device_id for update;
 if r.id<>p_recovery_id then raise exception 'RECOVERY_ID_MISMATCH'; end if;
 if r.state='completed' then return pos.get_sync_device_recovery(p_device_id); end if;
 select * into strict m from pos.system_manifest where singleton for share;
 if r.state<>'captured' or p_pending is distinct from 0 or p_epoch is distinct from m.data_epoch
  or p_protocol is distinct from r.protocol_version or p_protocol<m.sync_protocol_min
  or p_protocol>m.sync_protocol_current or p_epoch<>r.source_epoch
  or p_cursors is null then raise exception 'RECOVERY_NOT_CONVERGED'; end if;
 if exists(select 1 from pos.sync_domain_versions v where v.domain<>'devices'
  and coalesce(m.domain_modes->>v.domain,'active')='active'
  and (p_cursors->>v.domain)::bigint is distinct from v.version) then
  raise exception 'RECOVERY_NOT_CONVERGED';
 end if;
 update pos.sync_device_recoveries set state='completed',completed_at=now(),
  receipt=jsonb_build_object('pending',0,'epoch',p_epoch,'protocol',p_protocol,'cursors',p_cursors)
  where device_id=p_device_id;
 return pos.get_sync_device_recovery(p_device_id);
end $function$;

-- Arming requires the already authorized administrator/server operator. It freezes
-- only non-confirmed activity of the exact device; never infers a queue from a label.
create function pos.prepare_sync_device_recovery(p_device_id text,p_expected_count integer,
 p_epoch bigint,p_protocol integer,p_minimum_build text,p_authorization text) returns uuid
language plpgsql security definer set search_path=pg_catalog,pos as $function$
declare d pos.sync_devices%rowtype; ids text[]; result uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' and not pos.is_active_admin() then
  raise exception using errcode='42501',message='admin_required';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('pos.h149.recovery-fence',0));
 select * into strict d from pos.sync_devices where device_id=p_device_id for update;
 if d.queue_pending is distinct from p_expected_count or d.data_epoch is distinct from p_epoch
  or d.protocol_version is distinct from p_protocol
  or d.user_id is null or length(coalesce(p_authorization,''))<20 then
  raise exception 'RECOVERY_TARGET_MISMATCH';
 end if;
 if exists(select 1 from pos.sync_device_recoveries where device_id=p_device_id) then
  raise exception 'RECOVERY_ALREADY_PREPARED';
 end if;
 select array_agg(operation_id order by operation_id) into ids from pos.sync_activity
  where device_id=p_device_id and status<>'synced' and completed_at is null;
 if cardinality(ids)<p_expected_count or ids is null then raise exception 'RECOVERY_SCOPE_UNPROVEN'; end if;
 insert into pos.sync_device_recoveries(device_id,owner_id,expected_count,source_epoch,
  protocol_version,minimum_build,candidate_ids,created_by,authorization_reason)
 values(p_device_id,d.user_id,p_expected_count,p_epoch,p_protocol,p_minimum_build,ids,auth.uid(),p_authorization)
 returning id into result;
 return result;
end $function$;

revoke all on function pos.get_sync_device_recovery(text),
 pos.capture_sync_device_recovery(text,uuid,jsonb),
 pos.complete_sync_device_recovery(text,uuid,jsonb,bigint,integer,integer),
 pos.prepare_sync_device_recovery(text,integer,bigint,integer,text,text) from public,anon,authenticated;
grant execute on function pos.get_sync_device_recovery(text),
 pos.capture_sync_device_recovery(text,uuid,jsonb),
 pos.complete_sync_device_recovery(text,uuid,jsonb,bigint,integer,integer) to authenticated;
grant execute on function pos.prepare_sync_device_recovery(text,integer,bigint,integer,text,text)
 to authenticated,service_role;

-- GENERATED ENTRY GUARDS: body and ACL preserved; only an entry fence is added.
do $guard$ begin if md5(pg_get_functiondef('pos.commit_reference_family_batch(uuid,uuid,jsonb,integer,bigint)'::regprocedure))<>'7d7ec484d815e5c3da185a73b8058591' then raise exception 'H149 source drift: commit_reference_family_batch'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.commit_reference_family_batch(p_operation_id uuid, p_reference_family_id uuid, p_rows jsonb, p_protocol_version integer, p_data_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos'
AS $function$
begin
  perform pos.assert_device_recovery_write(null::text,array[p_operation_id::text]::text[]);
  perform pos.assert_device_recovery_write(x->>'sync_device_id',array[p_operation_id::text]::text[]) from jsonb_array_elements(p_rows) x;
  perform set_config('pos.h149_rpc','on',true);
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
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.reserve_sale_stock(text,text,jsonb)'::regprocedure))<>'124a0f3f39c4e1d93a4120543f970616' then raise exception 'H149 source drift: reserve_sale_stock'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.reserve_sale_stock(p_operation_id text, p_folio text, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare
  prior pos.stock_reservations%rowtype;
  shortages jsonb;
  rec record;
  updated_row jsonb;
  updated_products jsonb := '[]'::jsonb;
begin
  perform pos.assert_device_recovery_write(null::text,array[p_operation_id::text]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para reservar inventario'
      using errcode = '42501';
  end if;

  if nullif(trim(p_operation_id), '') is null
     or nullif(trim(p_folio), '') is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_lines)
        as x(product_id text, talla text, qty integer)
     where nullif(trim(x.product_id), '') is null
        or nullif(trim(x.talla), '') is null
        or x.qty is null
        or x.qty <= 0
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_lines');
  end if;

  -- Serializa reintentos de la misma operación antes de consultar idempotencia.
  perform pg_advisory_xact_lock(hashtext(p_operation_id));

  select * into prior
    from pos.stock_reservations
   where operation_id = p_operation_id;

  if found then
    if prior.folio <> p_folio or prior.lines <> p_lines then
      return jsonb_build_object('ok', false, 'error', 'operation_mismatch');
    end if;
    select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
      into updated_products
      from pos.products p
     where p.id in (
       select distinct x.product_id
         from jsonb_to_recordset(p_lines)
           as x(product_id text, talla text, qty integer)
     );
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'operation_id', p_operation_id,
      'products', updated_products
    );
  end if;

  -- El orden estable evita deadlocks cuando dos ventas incluyen varios modelos.
  perform p.id
    from pos.products p
   where p.id in (
     select distinct x.product_id
       from jsonb_to_recordset(p_lines)
         as x(product_id text, talla text, qty integer)
   )
   order by p.id
   for update;

  with requested as (
    select x.product_id, x.talla, sum(x.qty)::integer as qty
      from jsonb_to_recordset(p_lines)
        as x(product_id text, talla text, qty integer)
     group by x.product_id, x.talla
  ),
  availability as (
    select r.*,
           p.id is not null as product_exists,
           coalesce((
             select (elem ->> 'stock')::integer
               from jsonb_array_elements(p.stock) elem
              where elem ->> 'talla' = r.talla
              limit 1
           ), 0) as available
      from requested r
      left join pos.products p
        on p.id = r.product_id and p.deleted_at is null
  )
  select jsonb_agg(jsonb_build_object(
           'product_id', product_id,
           'talla', talla,
           'requested', qty,
           'available', available,
           'reason', case when not product_exists then 'product_not_found'
                          else 'insufficient_stock' end
         ) order by product_id, talla)
    into shortages
    from availability
   where not product_exists or available < qty;

  if shortages is not null then
    return jsonb_build_object(
      'ok', false, 'error', 'insufficient_stock', 'shortages', shortages
    );
  end if;

  for rec in
    with requested as (
      select x.product_id, x.talla, sum(x.qty)::integer as qty
        from jsonb_to_recordset(p_lines)
          as x(product_id text, talla text, qty integer)
       group by x.product_id, x.talla
    )
    select r.product_id, r.talla, r.qty,
           (elem.value ->> 'stock')::integer as available,
           elem.ordinality::integer - 1 as stock_index
      from requested r
      join pos.products p on p.id = r.product_id
      cross join lateral jsonb_array_elements(p.stock)
        with ordinality as elem(value, ordinality)
     where elem.value ->> 'talla' = r.talla
     order by r.product_id, r.talla
  loop
    update pos.products p
       set stock = jsonb_set(
             p.stock,
             array[rec.stock_index::text, 'stock'],
             to_jsonb(rec.available - rec.qty),
             false
           ),
           sync_base_version = p.sync_version,
           sync_device_id = 'sale:' || p_operation_id
     where p.id = rec.product_id
     returning to_jsonb(p.*) into updated_row;

  end loop;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
    into updated_products
    from pos.products p
   where p.id in (
     select distinct x.product_id
       from jsonb_to_recordset(p_lines)
         as x(product_id text, talla text, qty integer)
   );

  insert into pos.stock_reservations (
    operation_id, folio, lines, actor_email
  ) values (
    p_operation_id, p_folio, p_lines, auth.jwt() ->> 'email'
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'operation_id', p_operation_id,
    'products', updated_products
  );
end;
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.delete_products_checked_v2(uuid,text,uuid,jsonb,text,integer,bigint)'::regprocedure))<>'3493a0ccccc91ec9e32c0ed2f8e30ea8' then raise exception 'H149 source drift: delete_products_checked_v2'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.delete_products_checked_v2(p_operation_id uuid, p_scope text, p_reference_family_id uuid, p_targets jsonb, p_device_id text, p_protocol_version integer, p_data_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_ids text[];
  v_count integer;
  v_hash text;
  v_result jsonb;
begin
  perform pos.assert_device_recovery_write(p_device_id,array[p_operation_id::text]::text[]);
  perform set_config('pos.h149_rpc','on',true);
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
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.soft_delete_entity(text,text,bigint,text)'::regprocedure))<>'cd1d4a441ef2674a6699803fe94dea57' then raise exception 'H149 source drift: soft_delete_entity'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.soft_delete_entity(p_entity text, p_id text, p_base_version bigint, p_device_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare
  result jsonb;
begin
  perform pos.assert_device_recovery_write(p_device_id,array[]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  if p_entity not in ('products', 'clients', 'sellers', 'promotions') then
    raise exception 'Entidad no permitida: %', p_entity;
  end if;

  execute format(
    'update pos.%I
       set deleted_at = now(),
           sync_base_version = $2,
           sync_device_id = $3
     where id = $1
     returning to_jsonb(%I.*)',
    p_entity, p_entity
  ) into result using p_id, coalesce(p_base_version, 0), p_device_id;

  return result;
end;
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure))<>'a7aa10e05dd4b1299c02514a46dd00b5' then raise exception 'H149 source drift: commit_exchange_checked'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.commit_exchange_checked(p_commit_id text, p_exchange jsonb, p_items jsonb, p_moves jsonb DEFAULT '[]'::jsonb, p_payment jsonb DEFAULT NULL::jsonb, p_seller_effects jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare v_prior jsonb;
begin
  perform pos.assert_device_recovery_write(null::text,array[p_commit_id::text]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  perform 1 from pos.exchange_commits where commit_id=p_commit_id for share;
  if found then
    v_prior:=pos.h94_commit_exchange_delegate(p_commit_id,p_exchange,p_items,
      p_moves,p_payment,p_seller_effects);
    if v_prior->>'error' is distinct from 'commit_mismatch' then return v_prior; end if;
  end if;
  return pos.h133_commit_exchange_delegate(p_commit_id,p_exchange,
    pos.h133_operational_items(p_items,true,p_exchange->>'origen_folio'),p_moves,p_payment,p_seller_effects);
end;
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure))<>'92940d4e84a15055bf12218e4c72ef1b' then raise exception 'H149 source drift: commit_return_checked'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.commit_return_checked(p_commit_id text, p_return jsonb, p_items jsonb, p_moves jsonb, p_stock_lines jsonb, p_client_effect jsonb DEFAULT NULL::jsonb, p_seller_effects jsonb DEFAULT '[]'::jsonb, p_legacy boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare v_items jsonb;v_stock jsonb;v_prior jsonb;
begin
  perform pos.assert_device_recovery_write(null::text,array[p_commit_id::text]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  -- Already confirmed historical payloads retain their original idempotency hash.
  perform 1 from pos.return_commits where commit_id=p_commit_id for share;
  if found then
    v_prior:=pos.h94_commit_return_delegate(p_commit_id,p_return,p_items,p_moves,
      p_stock_lines,p_client_effect,p_seller_effects,p_legacy);
    if v_prior->>'error' is distinct from 'commit_mismatch' then return v_prior; end if;
  end if;
  v_items:=pos.h133_operational_items(p_items,false,p_return->>'folio');
  v_stock:=pos.h133_operational_items(p_stock_lines,false);
  return pos.h133_commit_return_delegate(p_commit_id,p_return,v_items,p_moves,v_stock,
    p_client_effect,p_seller_effects,p_legacy);
end;
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.commit_legacy_return(text,jsonb,jsonb,jsonb,jsonb)'::regprocedure))<>'34c6fe207965c22e12810ef16c2dc509' then raise exception 'H149 source drift: commit_legacy_return'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.commit_legacy_return(p_commit_id text, p_return jsonb, p_items jsonb, p_moves jsonb, p_targets jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare
  v_result jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_target record;
  v_products jsonb := '[]'::jsonb;
  v_clients jsonb := '[]'::jsonb;
  v_sellers jsonb := '[]'::jsonb;
begin
  perform pos.assert_device_recovery_write(null::text,array[p_commit_id::text]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para adoptar devoluciones'
      using errcode = '42501';
  end if;

  if not coalesce((p_targets ->> 'complete')::boolean, false)
     or jsonb_typeof(p_targets -> 'products') <> 'array'
     or jsonb_array_length(p_targets -> 'products') = 0
     or jsonb_typeof(coalesce(p_targets -> 'sellers', '[]'::jsonb)) <> 'array' then
    return jsonb_build_object(
      'ok', false, 'error', 'legacy_context_incomplete'
    );
  end if;

  -- Bloqueo estable de todos los objetivos antes de comprobar versiones.
  perform p.id
    from pos.products p
   where p.id in (
     select x.id from jsonb_to_recordset(p_targets -> 'products')
       as x(id text, base_version bigint, stock jsonb)
   )
   order by p.id
   for update;

  for v_target in
    select * from jsonb_to_recordset(p_targets -> 'products')
      as x(id text, base_version bigint, stock jsonb)
  loop
    if not exists (
      select 1 from pos.products p
       where p.id = v_target.id
         and p.deleted_at is null
         and (
           p.sync_version = coalesce(v_target.base_version, 0)
           or (
             p.sync_version = coalesce(v_target.base_version, 0) + 1
             and p.stock = v_target.stock
           )
         )
    ) then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'entity', 'products', 'id', v_target.id
      ));
    end if;
  end loop;

  if p_targets -> 'client' is not null
     and jsonb_typeof(p_targets -> 'client') = 'object' then
    perform 1 from pos.clients
     where id = p_targets -> 'client' ->> 'id'
     for update;
    if not exists (
      select 1 from pos.clients c
       where c.id = p_targets -> 'client' ->> 'id'
         and c.deleted_at is null
         and (
           c.sync_version = coalesce((p_targets -> 'client' ->> 'base_version')::bigint, 0)
           or (
             c.sync_version = coalesce((p_targets -> 'client' ->> 'base_version')::bigint, 0) + 1
             and c.total = coalesce((p_targets -> 'client' ->> 'total')::numeric, 0)
           )
         )
    ) then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'entity', 'clients', 'id', p_targets -> 'client' ->> 'id'
      ));
    end if;
  end if;

  perform s.id
    from pos.sellers s
   where s.id in (
     select x.id from jsonb_to_recordset(coalesce(p_targets -> 'sellers', '[]'::jsonb))
       as x(id text, base_version bigint, ventas_mes numeric, comision_acum numeric)
   )
   order by s.id
   for update;

  for v_target in
    select * from jsonb_to_recordset(coalesce(p_targets -> 'sellers', '[]'::jsonb))
      as x(id text, base_version bigint, ventas_mes numeric, comision_acum numeric)
  loop
    if not exists (
      select 1 from pos.sellers s
       where s.id = v_target.id
         and s.active is true
         and s.deleted_at is null
         and (
           s.sync_version = coalesce(v_target.base_version, 0)
           or (
             s.sync_version = coalesce(v_target.base_version, 0) + 1
             and s.ventas_mes = v_target.ventas_mes
             and s.comision_acum = v_target.comision_acum
           )
         )
    ) then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'entity', 'sellers', 'id', v_target.id
      ));
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object(
      'ok', false, 'error', 'legacy_version_conflict',
      'conflicts', v_conflicts
    );
  end if;

  -- Cabecera/renglones/movimientos se adoptan mediante el mismo commit
  -- idempotente. Los objetivos se aplican en esta misma transacción.
  v_result := pos.commit_return(
    p_commit_id, p_return, p_items, p_moves,
    '[]'::jsonb, null, '[]'::jsonb, true
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    return v_result;
  end if;

  for v_target in
    select * from jsonb_to_recordset(p_targets -> 'products')
      as x(id text, base_version bigint, stock jsonb)
  loop
    update pos.products
       set stock = v_target.stock,
           sync_base_version = sync_version,
           sync_device_id = 'legacy-return:' || p_commit_id
     where id = v_target.id
       and sync_version = coalesce(v_target.base_version, 0);
  end loop;

  if p_targets -> 'client' is not null
     and jsonb_typeof(p_targets -> 'client') = 'object' then
    update pos.clients
       set total = coalesce((p_targets -> 'client' ->> 'total')::numeric, 0),
           sync_base_version = sync_version,
           sync_device_id = 'legacy-return:' || p_commit_id
     where id = p_targets -> 'client' ->> 'id'
       and sync_version = coalesce((p_targets -> 'client' ->> 'base_version')::bigint, 0);
  end if;

  for v_target in
    select * from jsonb_to_recordset(coalesce(p_targets -> 'sellers', '[]'::jsonb))
      as x(id text, base_version bigint, ventas_mes numeric, comision_acum numeric)
  loop
    update pos.sellers
       set ventas_mes = v_target.ventas_mes,
           comision_acum = v_target.comision_acum,
           sync_base_version = sync_version,
           sync_device_id = 'legacy-return:' || p_commit_id
     where id = v_target.id
       and sync_version = coalesce(v_target.base_version, 0);
  end loop;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
    into v_products from pos.products p
   where p.id in (
     select x.id from jsonb_to_recordset(p_targets -> 'products')
       as x(id text, base_version bigint, stock jsonb)
   );
  if p_targets -> 'client' is not null
     and jsonb_typeof(p_targets -> 'client') = 'object' then
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
      into v_clients from pos.clients c
     where c.id = p_targets -> 'client' ->> 'id';
  end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
    into v_sellers from pos.sellers s
   where s.id in (
     select x.id from jsonb_to_recordset(coalesce(p_targets -> 'sellers', '[]'::jsonb))
       as x(id text, base_version bigint, ventas_mes numeric, comision_acum numeric)
   );

  return v_result || jsonb_build_object(
    'legacy_adopted', true,
    'products', v_products, 'clients', v_clients, 'sellers', v_sellers
  );
end;
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.commit_layaway_liquidation_checked(text,text,text,jsonb,jsonb,jsonb)'::regprocedure))<>'675f90b64d612f08282740b5e9899090' then raise exception 'H149 source drift: commit_layaway_liquidation_checked'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.commit_layaway_liquidation_checked(p_commit_id text, p_operation_id text, p_folio text, p_payment jsonb, p_seller_effects jsonb DEFAULT '[]'::jsonb, p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare
  v_result jsonb;
begin
  perform pos.assert_device_recovery_write(null::text,array[p_operation_id::text,p_commit_id::text]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  perform pos.require_current_capability('sales.collect');
  if p_context ? 'commission_rows'
     and p_context -> 'commission_rows' <> 'null'::jsonb
     and jsonb_typeof(p_context -> 'commission_rows') <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_commission_snapshot');
  end if;
  v_result := pos.commit_layaway_liquidation(
    p_commit_id, p_operation_id, p_folio, p_payment, p_seller_effects,
    p_context
  );
  -- H-69: el apartado comisiona AL LIQUIDARSE. El desglose por vendedor viaja en
  -- el contexto y se congela aqui, en la misma transaccion que confirma el pago.
  if coalesce((v_result ->> 'ok')::boolean, false)
     and p_context ? 'commission_rows'
     and jsonb_typeof(p_context -> 'commission_rows') = 'array' then
    update pos.sales
       set comisiones = p_context -> 'commission_rows'
     where folio = p_folio;
  end if;
  return v_result;
end;
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.commit_loan_operation(uuid,text,jsonb,bigint)'::regprocedure))<>'9e81030bf496b9732139a604240830a3' then raise exception 'H149 source drift: commit_loan_operation'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.commit_loan_operation(p_operation_id uuid, p_action text, p_loan jsonb, p_expected_version bigint DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare
 v_actor uuid:=auth.uid(); v_id text:=p_loan->>'id'; v_folio text:=p_loan->>'folio';
 v_new_state text:=p_loan->>'estado'; v_old pos.loan_documents%rowtype;
 v_cap text:='inventory.loan.'||p_action; v_hash text;
 v_result jsonb; v_has_events boolean;
begin
  perform pos.assert_device_recovery_write(null::text,array[p_operation_id::text]::text[]);
  perform set_config('pos.h149_rpc','on',true);
 if p_action not in('deliver','return','shortage','edit','delete','reopen')
 or p_operation_id is null or nullif(trim(v_id),'') is null then
  raise exception 'INVALID_LOAN_OPERATION' using errcode='22023';
 end if;
 perform pos.require_current_capability(v_cap);
 perform pg_advisory_xact_lock(hashtext(v_id));
 v_hash:=md5(jsonb_build_array(p_action,p_loan,p_expected_version)::text);
 select result into v_result from pos.capability_operation_audit
  where operation_id=p_operation_id and capability_key=v_cap and payload_hash=v_hash;
 if found then return v_result; end if;
 if exists(select 1 from pos.capability_operation_audit where operation_id=p_operation_id)
 then raise exception 'LOAN_OPERATION_CONFLICT' using errcode='40001'; end if;
 select * into v_old from pos.loan_documents where id=v_id for update;

 if p_action='deliver' then
  -- H-62: la entrega admite los TRES estados del contrato, no sólo `pendiente`.
  -- La migración de los préstamos que vivían sólo en una terminal debe poder
  -- adoptar documentos ya cerrados —devueltos o dados por no devueltos—
  -- conservando su estado, sus devoluciones y sus fechas originales. Un
  -- documento adoptado con devoluciones nace con `has_events`, de modo que las
  -- guardas de edición y baja lo protegen igual que si hubiera nacido aquí.
  if found or v_new_state not in('pendiente','devuelto','no_devuelto')
  or nullif(trim(v_folio),'') is null
  or jsonb_typeof(p_loan->'lineas')<>'array'
  or jsonb_array_length(p_loan->'lineas')=0 then
   raise exception 'INVALID_LOAN_DELIVERY' using errcode='22023'; end if;
  v_has_events:=v_new_state<>'pendiente'
   or coalesce(jsonb_array_length(nullif(p_loan->'devoluciones','null'::jsonb)),0)>0;
  -- Choque de folio entre terminales. Se captura la violación de unicidad en
  -- lugar de comprobar antes con un `select`, porque así queda cubierta también
  -- la carrera entre dos entregas simultáneas: el candado de arriba serializa
  -- por `id`, no por folio.
  begin
   insert into pos.loan_documents(id,folio,state,document,has_events)
   values(v_id,v_folio,v_new_state,p_loan,v_has_events);
  exception when unique_violation then
   return jsonb_build_object('ok',false,'error','folio_conflict');
  end;
 else
  if not found or v_old.deleted_at is not null
  then raise exception 'LOAN_NOT_FOUND' using errcode='P0002'; end if;
  if v_old.version<>coalesce(p_expected_version,0)
  then raise exception 'LOAN_VERSION_CONFLICT' using errcode='40001'; end if;
  if p_action in('edit','delete') and
    (v_old.has_events or v_old.state<>'pendiente') then
   raise exception 'LOAN_ALREADY_HAS_EFFECTS' using errcode='23514'; end if;
  if p_action='return' then
   if v_old.state='devuelto' or v_new_state not in('pendiente','devuelto')
   then raise exception 'INVALID_LOAN_RETURN' using errcode='23514'; end if;
   if v_old.state='no_devuelto' then
    perform pos.require_current_capability('inventory.loan.reopen');
   end if;
   if v_new_state='devuelto' then
    perform pos.require_current_capability('inventory.loan.close');
   end if;
   v_has_events:=true;
  elsif p_action='shortage' then
   if v_old.state<>'pendiente' or v_new_state<>'no_devuelto'
   then raise exception 'INVALID_LOAN_SHORTAGE' using errcode='23514'; end if;
   perform pos.require_current_capability('inventory.loan.close');
   v_has_events:=true;
  elsif p_action='reopen' then
   if v_old.state<>'no_devuelto' or v_new_state<>'pendiente'
   then raise exception 'INVALID_LOAN_REOPEN' using errcode='23514'; end if;
   v_has_events:=true;
  elsif p_action='delete' then
   update pos.loan_documents set deleted_at=now(),version=version+1,updated_at=now()
    where id=v_id returning jsonb_build_object('id',id,'version',version,
      'deleted_at',deleted_at) into v_result;
  end if;
  if p_action<>'delete' then
   update pos.loan_documents set document=p_loan,state=v_new_state,
    has_events=coalesce(v_has_events,has_events),version=version+1,updated_at=now()
   where id=v_id returning document||jsonb_build_object('_loanVersion',version)
    into v_result;
  end if;
 end if;
 if p_action='deliver' then
  select document||jsonb_build_object('_loanVersion',version) into v_result
  from pos.loan_documents where id=v_id;
 end if;
 insert into pos.capability_operation_audit(operation_id,capability_key,
  actor_user_id,subject_key,payload_hash,result)
 values(p_operation_id,v_cap,v_actor,v_id,v_hash,v_result);
 return v_result;
end; $function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.settle_commission_checked(uuid,text)'::regprocedure))<>'23f245792e19bbaf2ad1631b441ba223' then raise exception 'H149 source drift: settle_commission_checked'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.settle_commission_checked(p_operation_id uuid, p_seller_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'auth', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_hash text := md5(coalesce(p_seller_id, ''));
  v_existing pos.capability_operation_audit%rowtype;
  v_seller pos.sellers%rowtype;
  v_result jsonb;
begin
  perform pos.assert_device_recovery_write(null::text,array[p_operation_id::text]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  perform pos.require_current_capability('commissions.settle');
  if p_operation_id is null or nullif(trim(p_seller_id), '') is null then
    raise exception 'COMMISSION_OPERATION_INVALID' using errcode = '22023';
  end if;

  select * into v_existing
  from pos.capability_operation_audit
  where operation_id = p_operation_id;
  if found then
    if v_existing.capability_key <> 'commissions.settle'
       or v_existing.actor_user_id <> v_actor
       or v_existing.payload_hash <> v_hash then
      raise exception 'CAPABILITY_OPERATION_CONFLICT' using errcode = '22023';
    end if;
    return v_existing.result;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_seller_id, 5601));
  select * into v_seller
  from pos.sellers
  where id = p_seller_id and deleted_at is null
  for update;
  if not found then
    raise exception 'COMMISSION_SELLER_NOT_FOUND' using errcode = '22023';
  end if;

  if coalesce(v_seller.comision_acum, 0) > 0 then
    insert into pos.liquidations(id, seller_id, seller, monto, tipo, fecha)
    values (
      'liq-' || p_operation_id::text, v_seller.id, v_seller.nombre,
      round(v_seller.comision_acum, 2), 'liquidacion',
      to_char(statement_timestamp(), 'YYYY-MM-DD HH24:MI')
    );
  end if;
  update pos.sellers
  set comision_acum = 0
  where id = v_seller.id;

  v_result := jsonb_build_object(
    'operation_id', p_operation_id,
    'seller_id', v_seller.id,
    'seller', v_seller.nombre,
    'amount', round(coalesce(v_seller.comision_acum, 0), 2),
    'settled_at', statement_timestamp()
  );
  insert into pos.capability_operation_audit(
    operation_id, capability_key, actor_user_id, subject_key,
    payload_hash, result
  ) values (
    p_operation_id, 'commissions.settle', v_actor, v_seller.id,
    v_hash, v_result
  );
  return v_result;
end;
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.close_commission_period_checked(uuid)'::regprocedure))<>'0de2c911c00a626248eedf9937db2dc0' then raise exception 'H149 source drift: close_commission_period_checked'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.close_commission_period_checked(p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'auth', 'pg_temp'
AS $function$
begin
  perform pos.assert_device_recovery_write(null::text,array[p_operation_id::text]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  return pos.close_commission_period_internal(p_operation_id, null);
end;
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.apply_commission_adjustment_checked(uuid,jsonb,text)'::regprocedure))<>'7aaf90fccaab7c77f2c5c67a677e3702' then raise exception 'H149 source drift: apply_commission_adjustment_checked'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.apply_commission_adjustment_checked(p_operation_id uuid, p_rows jsonb, p_motivo text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'auth', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_hash text := md5(coalesce(p_rows::text, '[]'));
  v_existing pos.capability_operation_audit%rowtype;
  v_row record;
  v_total numeric := 0;
  v_count integer := 0;
  v_result jsonb;
begin
  perform pos.assert_device_recovery_write(null::text,array[p_operation_id::text]::text[]);
  perform pos.assert_device_recovery_write(x->>'sync_device_id',array[p_operation_id::text]::text[]) from jsonb_array_elements(p_rows) x;
  perform set_config('pos.h149_rpc','on',true);
  perform pos.require_current_capability('commissions.settle');
  if p_operation_id is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'COMMISSION_ADJUSTMENT_INVALID' using errcode = '22023';
  end if;

  -- Idempotencia por (operacion, actor, huella del payload), igual que el resto
  -- de capacidades de H-56: repetir la llamada devuelve el mismo resultado y no
  -- vuelve a acreditar.
  select * into v_existing
  from pos.capability_operation_audit
  where operation_id = p_operation_id;
  if found then
    if v_existing.capability_key <> 'commissions.adjust'
       or v_existing.actor_user_id <> v_actor
       or v_existing.payload_hash <> v_hash then
      raise exception 'CAPABILITY_OPERATION_CONFLICT' using errcode = '22023';
    end if;
    return v_existing.result;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('commissions.adjust', 69));

  for v_row in
    select x.seller_id, x.monto, x.ventas
      from jsonb_to_recordset(p_rows)
        as x(seller_id text, monto numeric, ventas integer)
  loop
    if nullif(trim(v_row.seller_id), '') is null or coalesce(v_row.monto, 0) <= 0 then
      continue;
    end if;
    update pos.sellers
       set comision_acum = round(coalesce(comision_acum, 0) + v_row.monto, 2)
     where id = v_row.seller_id and deleted_at is null;
    if not found then
      raise exception 'COMMISSION_SELLER_NOT_FOUND' using errcode = '22023';
    end if;
    insert into pos.liquidations(id, seller_id, seller, monto, tipo, fecha)
    select 'adj-' || p_operation_id::text || '-' || v_row.seller_id,
           s.id, s.nombre, round(v_row.monto, 2), 'ajuste',
           to_char(statement_timestamp(), 'YYYY-MM-DD HH24:MI')
      from pos.sellers s where s.id = v_row.seller_id
    on conflict (id) do nothing;
    v_total := v_total + v_row.monto;
    v_count := v_count + 1;
  end loop;

  insert into pos.commission_adjustments(
    operation_id, actor_user_id, motivo, total, vendedores, detalle
  ) values (
    p_operation_id, v_actor, nullif(trim(coalesce(p_motivo, '')), ''),
    round(v_total, 2), v_count, p_rows
  );

  v_result := jsonb_build_object(
    'operation_id', p_operation_id,
    'total', round(v_total, 2),
    'sellers', v_count,
    'applied_at', statement_timestamp()
  );
  insert into pos.capability_operation_audit(
    operation_id, capability_key, actor_user_id, subject_key, payload_hash, result
  ) values (
    p_operation_id, 'commissions.adjust', v_actor, null, v_hash, v_result
  );
  return v_result;
end;
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.commit_config(text,bigint,text,jsonb,jsonb,integer,bigint)'::regprocedure))<>'66b064e946320e557e8353b580c19f21' then raise exception 'H149 source drift: commit_config'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.commit_config(p_operation_id text, p_expected_version bigint, p_device_id text, p_lookup jsonb, p_settings jsonb, p_protocol_version integer, p_data_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'auth', 'pg_temp'
AS $function$
declare
  v_manifest pos.system_manifest%rowtype;
  v_version bigint;
  v_hash text;
  v_prior pos.config_commits%rowtype;
begin
  perform pos.assert_device_recovery_write(p_device_id,array[p_operation_id::text]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  if not pos.is_active_admin()
     or not pos.current_has_capability('settings.manage') then
    raise exception using errcode='42501', message='settings_manage_required';
  end if;
  if p_operation_id is null or p_operation_id='' then
    raise exception using errcode='22023', message='operation_id_required';
  end if;
  if jsonb_typeof(p_lookup) <> 'array' or jsonb_array_length(p_lookup)=0
     or jsonb_typeof(p_settings) <> 'array' then
    raise exception using errcode='22023', message='invalid_config_snapshot';
  end if;

  select * into v_manifest from pos.system_manifest where singleton for share;
  if p_protocol_version < v_manifest.sync_protocol_min
     or p_protocol_version > v_manifest.sync_protocol_current then
    raise exception using errcode='P0001', message='sync_protocol_outdated';
  end if;
  if p_data_epoch <> v_manifest.data_epoch then
    raise exception using errcode='P0001', message='rebootstrap_required';
  end if;

  v_hash := md5(p_lookup::text || E'\n' || p_settings::text);
  select * into v_prior from pos.config_commits where operation_id=p_operation_id;
  if found then
    if v_prior.payload_hash <> v_hash then
      raise exception using errcode='P0001', message='config_commit_mismatch';
    end if;
    return jsonb_build_object('ok',true,'idempotent',true,
      'version',v_prior.committed_version,'data_epoch',v_manifest.data_epoch);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pos.config',0));
  select version into v_version from pos.config_sync_state where singleton for update;
  if coalesce(p_expected_version,0) <> v_version then
    return jsonb_build_object('ok',false,'error','config_version_conflict',
      'version',v_version,'data_epoch',v_manifest.data_epoch);
  end if;

  insert into pos.lookup(kind,code,label,active,meta,sort_order,updated_at)
  select x.kind,x.code,x.label,coalesce(x.active,true),coalesce(x.meta,'{}'::jsonb),
    coalesce(x.sort_order,0),now()
  from jsonb_to_recordset(p_lookup) as x(
    kind text, code text, label text, active boolean, meta jsonb, sort_order integer)
  on conflict(kind,code) do update set label=excluded.label, active=excluded.active,
    meta=excluded.meta, sort_order=excluded.sort_order, updated_at=now();

  delete from pos.lookup l where not exists(
    select 1 from jsonb_to_recordset(p_lookup) as x(kind text,code text)
    where x.kind=l.kind and x.code=l.code
  );

  insert into pos.settings(key,value,updated_at)
  select x.key,x.value,now()
  from jsonb_to_recordset(p_settings) as x(key text,value jsonb)
  on conflict(key) do update set value=excluded.value,updated_at=now();

  update pos.config_sync_state set version=version+1,updated_at=now()
  where singleton returning version into v_version;
  insert into pos.config_commits(operation_id,payload_hash,committed_version,device_id)
  values(p_operation_id,v_hash,v_version,p_device_id);
  return jsonb_build_object('ok',true,'idempotent',false,'version',v_version,
    'data_epoch',v_manifest.data_epoch);
end;
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.save_products_checked_v2(uuid,jsonb,integer,bigint)'::regprocedure))<>'9b110b519e6088723f0132bd145d6e32' then raise exception 'H149 source drift: save_products_checked_v2'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.save_products_checked_v2(p_operation_id uuid, p_rows jsonb, p_protocol_version integer, p_data_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos'
AS $function$
begin
  perform pos.assert_device_recovery_write(null::text,array[p_operation_id::text]::text[]);
  perform pos.assert_device_recovery_write(x->>'sync_device_id',array[p_operation_id::text]::text[]) from jsonb_array_elements(p_rows) x;
  perform set_config('pos.h149_rpc','on',true);
  perform pos.assert_sync_write_context(p_protocol_version,p_data_epoch);
  return pos.save_products_checked(p_operation_id,p_rows);
end;
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.delete_product_checked_v2(uuid,text,bigint,text,integer,bigint)'::regprocedure))<>'016ef466664b74904833ca4bb78b92ed' then raise exception 'H149 source drift: delete_product_checked_v2'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.delete_product_checked_v2(p_operation_id uuid, p_id text, p_base_version bigint, p_device_id text, p_protocol_version integer, p_data_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare v_family uuid; v_result jsonb;
begin
  perform pos.assert_device_recovery_write(p_device_id,array[p_operation_id::text]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  select reference_family_id into v_family from pos.products where id=p_id;
  v_result := pos.delete_products_checked_v2(
    p_operation_id,'reference',v_family,
    jsonb_build_array(jsonb_build_object('id',p_id,'baseVersion',coalesce(p_base_version,0))),
    p_device_id,p_protocol_version,p_data_epoch
  );
  return v_result->'rows'->0;
end;
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.commit_reference_reclassification(text,text,text,integer,text,text,text)'::regprocedure))<>'73913daaccbd9dff1b16738842c2a5c9' then raise exception 'H149 source drift: commit_reference_reclassification'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.commit_reference_reclassification(p_operation_id text, p_source_product_id text, p_target_product_id text, p_quantity integer, p_actor text, p_reason text, p_reversal_of text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare
  v_source pos.products%rowtype; v_target pos.products%rowtype;
  v_existing pos.reference_reclassifications%rowtype;
  v_original pos.reference_reclassifications%rowtype;
begin
  perform pos.assert_device_recovery_write(null::text,array[p_operation_id::text]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  perform pos.require_current_capability('inventory.adjust');
  if nullif(trim(p_operation_id), '') is null or p_quantity <= 0
     or nullif(trim(p_actor), '') is null or nullif(trim(p_reason), '') is null then
    raise exception 'INVALID_RECLASSIFICATION';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_operation_id));
  select * into v_existing from pos.reference_reclassifications where operation_id=p_operation_id;
  if v_existing.operation_id is not null then
    if v_existing.source_product_id<>p_source_product_id or v_existing.target_product_id<>p_target_product_id
       or v_existing.quantity<>p_quantity or v_existing.reversal_of is distinct from p_reversal_of then
      raise exception 'RECLASSIFICATION_OPERATION_CONFLICT' using errcode='40001';
    end if;
    return jsonb_build_object('ok',true,'idempotent',true,'operation',to_jsonb(v_existing));
  end if;
  perform 1 from pos.products where id in(p_source_product_id,p_target_product_id) order by id for update;
  select * into v_source from pos.products where id=p_source_product_id and deleted_at is null;
  select * into v_target from pos.products where id=p_target_product_id and deleted_at is null;
  if v_source.id is null or v_target.id is null or v_source.record_model <> 'v2' or v_target.record_model <> 'v2' then
    raise exception 'REFERENCE_NOT_FOUND';
  end if;
  if v_source.stock_quantity < p_quantity then raise exception 'INSUFFICIENT_REFERENCE_STOCK'; end if;
  if p_reversal_of is not null then
    select * into v_original from pos.reference_reclassifications where operation_id=p_reversal_of for update;
    if v_original.operation_id is null or v_original.reversed_by is not null
       or v_original.source_product_id<>p_target_product_id
       or v_original.target_product_id<>p_source_product_id
       or v_original.quantity<>p_quantity then
      raise exception 'RECLASSIFICATION_NOT_REVERSIBLE';
    end if;
  end if;

  update pos.products set stock_quantity = stock_quantity - p_quantity where id = p_source_product_id;
  update pos.products set stock_quantity = stock_quantity + p_quantity where id = p_target_product_id;
  insert into pos.reference_reclassifications(
    operation_id, source_product_id, target_product_id, quantity, actor, actor_user_id, reason, reversal_of
  ) values (p_operation_id, p_source_product_id, p_target_product_id, p_quantity,
    trim(p_actor), auth.uid(), trim(p_reason), p_reversal_of);
  if p_reversal_of is not null then
    update pos.reference_reclassifications set reversed_by = p_operation_id where operation_id = p_reversal_of;
  end if;
  insert into pos.movements(fecha, tipo, producto, sku, talla, cant, ref, product_id, operation_id)
  values
    (now(), 'Reclasificación', v_source.nombre, v_source.sku, v_source.size_code, -p_quantity, p_reason, v_source.id, p_operation_id),
    (now(), 'Reclasificación', v_target.nombre, v_target.sku, v_target.size_code,  p_quantity, p_reason, v_target.id, p_operation_id);
  return jsonb_build_object('ok', true, 'idempotent', false, 'operation_id', p_operation_id,
    'source_stock', v_source.stock_quantity - p_quantity,
    'target_stock', v_target.stock_quantity + p_quantity);
end;
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)'::regprocedure))<>'6fe9c9a3682bf46d04078131309aa8af' then raise exception 'H149 source drift: commit_sale_checked'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.commit_sale_checked(p_commit_id text, p_operation_id text, p_sale jsonb, p_items jsonb, p_moves jsonb, p_payments jsonb, p_stock_lines jsonb, p_reserve_stock boolean, p_client_effect jsonb DEFAULT NULL::jsonb, p_seller_effects jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$ declare r jsonb; begin
  perform pos.assert_device_recovery_write(null::text,array[p_operation_id::text,p_commit_id::text]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  perform pos.h94_assert_v2_document_items(p_items);
  r:=pos.h94_commit_sale_delegate(p_commit_id,p_operation_id,p_sale,p_items,p_moves,p_payments,p_stock_lines,p_reserve_stock,p_client_effect,p_seller_effects);
  if coalesce((r->>'ok')::boolean,false) then perform pos.h94_persist_sale_references(p_sale->>'folio',p_items); end if; return r; end $function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)'::regprocedure))<>'154fb6a84b38030c351c22e802435356' then raise exception 'H149 source drift: commit_sale_with_additional_discount_checked'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.commit_sale_with_additional_discount_checked(p_commit_id text, p_operation_id text, p_sale jsonb, p_items jsonb, p_moves jsonb, p_payments jsonb, p_stock_lines jsonb, p_reserve_stock boolean, p_client_effect jsonb DEFAULT NULL::jsonb, p_seller_effects jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$ declare r jsonb; begin
  perform pos.assert_device_recovery_write(null::text,array[p_operation_id::text,p_commit_id::text]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  perform pos.h94_assert_v2_document_items(p_items);
  r:=pos.h94_commit_sale_with_discount_delegate(p_commit_id,p_operation_id,p_sale,p_items,p_moves,p_payments,p_stock_lines,p_reserve_stock,p_client_effect,p_seller_effects);
  if coalesce((r->>'ok')::boolean,false) then perform pos.h94_persist_sale_references(p_sale->>'folio',p_items); end if; return r; end $function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.reserve_folio_block(text,date,integer,integer)'::regprocedure))<>'b2e9d083efbb93558424381a0f39c70f' then raise exception 'H149 source drift: reserve_folio_block'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.reserve_folio_block(p_prefix text, p_business_date date, p_count integer DEFAULT 1, p_floor integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare
  v_prefix text;
  v_count integer;
  v_floor integer;
  v_to integer;
begin
  perform pos.assert_device_recovery_write(null::text,array[]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para reservar folios'
      using errcode = '42501';
  end if;

  v_prefix := left(upper(regexp_replace(coalesce(p_prefix, ''), '[^A-Za-z0-9]', '', 'g')), 6);
  if v_prefix = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_prefix');
  end if;
  if p_business_date is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_business_date');
  end if;

  v_count := least(greatest(coalesce(p_count, 1), 1), 100);
  v_floor := greatest(coalesce(p_floor, 0), 0);

  insert into pos.folio_counters as fc (prefix, business_date, last_seq)
  values (v_prefix, p_business_date, v_floor + v_count)
  on conflict (prefix, business_date) do update
    set last_seq = greatest(fc.last_seq, v_floor) + v_count,
        updated_at = now()
  returning fc.last_seq into v_to;

  return jsonb_build_object(
    'ok', true,
    'prefix', v_prefix,
    'business_date', to_char(p_business_date, 'YYYY-MM-DD'),
    'from', v_to - v_count + 1,
    'to', v_to
  );
end;
$function$
;
do $guard$ begin if md5(pg_get_functiondef('pos.claim_physical_card(text,text)'::regprocedure))<>'55865fc1e57f7d8efae01d15a9e9e943' then raise exception 'H149 source drift: claim_physical_card'; end if; end $guard$;
CREATE OR REPLACE FUNCTION pos.claim_physical_card(p_folio text, p_claim_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare
  v_folio text := upper(trim(p_folio));
  v_token text := trim(p_claim_token);
  v_existing pos.physical_card_redemptions%rowtype;
begin
  perform pos.assert_device_recovery_write(null::text,array[]::text[]);
  perform set_config('pos.h149_rpc','on',true);
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para validar tarjetas' using errcode = '42501';
  end if;
  if nullif(v_folio, '') is null or nullif(v_token, '') is null then return false; end if;
  perform pg_advisory_xact_lock(hashtext('physical-card:' || v_folio));
  select * into v_existing from pos.physical_card_redemptions where folio = v_folio;
  if found and v_existing.sale_folio is not null then return false; end if;
  if found and v_existing.claim_token = v_token then return true; end if;
  if found and v_existing.claimed_at > now() - interval '15 minutes' then return false; end if;
  delete from pos.physical_card_redemptions where folio = v_folio;
  insert into pos.physical_card_redemptions(folio, claim_token, claimed_by)
  values (v_folio, v_token, auth.uid());
  return true;
end;
$function$
;
create trigger h149_recovery_fence before insert or update or delete on pos.products for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.clients for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.sellers for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.promotions for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.sales for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.sale_items for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.sale_payments for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.returns for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.return_items for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.exchanges for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.exchange_items for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.movements for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.loan_documents for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.liquidations for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.commission_adjustments for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.lookup for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.settings for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.stock_reservations for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.sale_commits for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.return_commits for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.exchange_commits for each row execute function pos.guard_device_recovery_row();
create trigger h149_recovery_fence before insert or update or delete on pos.reference_reclassifications for each row execute function pos.guard_device_recovery_row();
notify pgrst,'reload schema';
commit;

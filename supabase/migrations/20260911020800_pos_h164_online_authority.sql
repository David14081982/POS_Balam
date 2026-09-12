-- H164: one online commercial authority, immutable terminal receipts, no replay.
-- Existing commercial documents and authoritative financial RPCs are preserved.
-- Rollout is explicit: installing this migration does not enable the legacy fence.
begin;
set local lock_timeout = '10s';

create table pos.online_runtime (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 contract_version integer not null default 1 check(contract_version=1),
 activated_at timestamptz,
 activated_by uuid
);
insert into pos.online_runtime(singleton) values(true);
create table pos.online_requests (
 actor_id uuid not null,
 request_id uuid not null,
 command_hash text,
 command_kind text,
 device_id text,
 state text not null check(state in('executing','confirmed','rejected','cancelled')),
 response jsonb,
 created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 primary key(actor_id,request_id),
 check((state='executing' and response is null and completed_at is null)
    or (state<>'executing' and response is not null and completed_at is not null))
);
create table pos.online_legacy_archives (
 actor_id uuid not null,
 device_id text not null,
 source_key text not null,
 source_hash text not null,
 operation_id text,
 original jsonb not null,
 original_hash text not null,
 classification text not null check(classification in('retained_history','confirmed','authorized_discard','needs_review')),
 evidence jsonb not null default '{}'::jsonb,
 archived_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,device_id,source_key,source_hash)
);
create table pos.online_legacy_operations (
 actor_id uuid not null,device_id text not null,operation_id text not null,payload_hash text not null,
 original jsonb not null,classification text not null check(classification in('confirmed','authorized_discard','needs_review')),
 evidence jsonb not null default '{}',archived_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,device_id,operation_id,payload_hash)
);
alter table pos.online_runtime enable row level security;
alter table pos.online_requests enable row level security;
alter table pos.online_legacy_archives enable row level security;
alter table pos.online_legacy_operations enable row level security;
revoke all on pos.online_runtime,pos.online_requests,pos.online_legacy_archives,pos.online_legacy_operations from public,anon,authenticated;
grant all on pos.online_runtime,pos.online_requests,pos.online_legacy_archives,pos.online_legacy_operations to service_role;
grant select on pos.online_runtime to authenticated;
create policy online_runtime_active_read on pos.online_runtime for select to authenticated
 using(pos.is_active_admin() or pos.is_active_seller());

-- Internal context is backed by a row inaccessible to browser roles. A header
-- or a client-supplied epoch cannot manufacture permission to bypass the fence.
create function pos.online_request_context() returns boolean
language sql stable security definer set search_path=pg_catalog,pos,auth as $$
 select exists(select 1 from pos.online_requests r
  where r.actor_id=auth.uid() and r.request_id::text=current_setting('pos.online_request',true)
   and r.state='executing')
$$;
revoke all on function pos.online_request_context() from public,anon,authenticated;

create function pos.assert_online_device() returns text
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare
 h jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
 d text:=nullif(h->>'x-balam-device-id','');
 v_device pos.sync_devices%rowtype;
begin
 if auth.uid() is null or not(pos.is_active_admin() or pos.is_active_seller()) then
  raise exception using errcode='42501',message='ACTIVE_PROFILE_REQUIRED';
 end if;
 if d is null then raise exception using errcode='22023',message='DEVICE_ID_REQUIRED'; end if;
 select * into v_device from pos.sync_devices where device_id=d for share;
 if not found then raise exception using errcode='22023',message='DEVICE_REGISTRATION_REQUIRED'; end if;
 if v_device.status='revoked' then raise exception using errcode='42501',message='DEVICE_RETIRED'; end if;
 return d;
end $$;
revoke all on function pos.assert_online_device() from public,anon,authenticated;

create function pos.guard_online_commercial_write() returns trigger
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
begin
 if (select enabled from pos.online_runtime where singleton) and not pos.online_request_context()
    and not(auth.uid() is null and ((session_user in('postgres','service_role','supabase_admin')
      and coalesce(current_setting('role',true),'none') not in('anon','authenticated'))
     or (coalesce(auth.jwt()->>'role','')='service_role' and current_setting('role',true)='service_role'))) then
  raise exception using errcode='42501',message='ONLINE_COMMAND_REQUIRED';
 end if;
 if TG_OP='DELETE' then return OLD; end if;
 return NEW;
end $$;
revoke all on function pos.guard_online_commercial_write() from public,anon,authenticated;

-- This is an explicit, schema-owned list, never a client-selected table.
do $fences$
declare t text;
begin
 foreach t in array array[
  'products','clients','sellers','promotions','sales','sale_items','sale_payments',
  'returns','return_items','exchanges','exchange_items','movements','loan_documents',
  'liquidations','commission_adjustments','lookup','settings','stock_reservations',
  'sale_commits','return_commits','exchange_commits','layaway_liquidation_commits',
  'reference_reclassifications','physical_card_redemptions','folio_counters',
  'config_commits','config_sync_state','screen_permission_catalog','screen_permission_catalog_state',
  'user_permission_role_assignments','role_screen_permissions','user_screen_permission_overrides',
  'user_capability_overrides','role_capability_permissions','permission_roles'
 ] loop
  execute format('create trigger h164_online_authority before insert or update or delete on pos.%I for each row execute function pos.guard_online_commercial_write()',t);
 end loop;
end $fences$;

-- R-DB-03: splice only a new entry branch into the LIVE function; retain its
-- existing legacy path until rollout activation. No financial body is copied.
do $entry$
declare f text; before_hash text; insertion text;
begin
 f:=pg_get_functiondef('pos.assert_device_recovery_write(text,text[])'::regprocedure);
 before_hash:=md5(f);
 if position('REBOOTSTRAP_REQUIRED' in f)=0 or position('TEST_PENDING_DISCARDED' in f)=0
  or position('begin' in f)=0 then raise exception 'H164_DEVICE_GUARD_SOURCE_DRIFT'; end if;
 insertion:=$branch$begin
 if pos.online_request_context() then
  perform pos.assert_online_device();
  if exists(select 1 from pos.sync_quarantine_cases q where q.discarded_by_cleanup is not null
    and (q.operation_id=any(coalesce(p_operation_ids,'{}'::text[]))
      or coalesce(q.payload_summary->'operationIds','[]'::jsonb) ?| coalesce(p_operation_ids,'{}'::text[])))
    or exists(select 1 from pos.sync_device_recoveries recovery_row
      where recovery_row.candidate_ids && coalesce(p_operation_ids,'{}'::text[])) then
   raise exception using errcode='P0001',message='TEST_PENDING_DISCARDED';
  end if;
  return;
 end if;
 if (select enabled from pos.online_runtime where singleton) and auth.uid() is not null then
  raise exception using errcode='42501',message='ONLINE_COMMAND_REQUIRED';
 end if;
$branch$;
 -- First PL/pgSQL block only; preserve every byte following its BEGIN token.
 f:=overlay(f placing insertion from position('begin' in f) for 5);
 execute f;
 if md5(pg_get_functiondef('pos.assert_device_recovery_write(text,text[])'::regprocedure))=before_hash then
  raise exception 'H164_DEVICE_GUARD_NOT_CHANGED'; end if;
end $entry$;

-- Base versions are checked BEFORE any INSERT trigger can consume them (H156).
-- Serializing new IDs also prevents two concurrent creations from becoming an upsert.
create function pos.online_check_rows(p_kind text,p_rows jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare r jsonb; old_row jsonb;
begin
 if not pos.online_request_context() then raise exception 'ONLINE_COMMAND_REQUIRED' using errcode='42501'; end if;
 if p_kind is null or p_kind not in('products','clients','sellers','promotions') or jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows)=0
  or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p_rows) x) then
  raise exception 'INVALID_ONLINE_ROWS' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(p_rows) order by value->>'id' loop
  if nullif(r->>'id','') is null or not r ? 'sync_base_version'
    or (r->>'sync_base_version')::bigint<0 then raise exception 'BASE_VERSION_REQUIRED' using errcode='22023'; end if;
  old_row:=null;
  case p_kind
   when 'products' then select to_jsonb(t) into old_row from pos.products t where id=r->>'id' for update;
   when 'clients' then select to_jsonb(t) into old_row from pos.clients t where id=r->>'id' for update;
   when 'sellers' then select to_jsonb(t) into old_row from pos.sellers t where id=r->>'id' for update;
   when 'promotions' then select to_jsonb(t) into old_row from pos.promotions t where id=r->>'id' for update;
  end case;
  if (old_row is null and (r->>'sync_base_version')::bigint<>0)
   or (old_row is not null and ((old_row->>'sync_version')::bigint<>(r->>'sync_base_version')::bigint
    or old_row->>'deleted_at' is not null)) then
   raise exception using errcode='40001',message='ENTITY_VERSION_CONFLICT',detail=p_kind||':'||(r->>'id');
  end if;
 end loop;
end $$;
revoke all on function pos.online_check_rows(text,jsonb) from public,anon,authenticated;

create function pos.online_save_entities(p_kind text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare r jsonb; saved jsonb; result jsonb:='[]'; exists_row boolean; old_profile jsonb;
begin
 perform pos.online_check_rows(p_kind,p_rows);
 if p_kind not in('clients','sellers','promotions') then raise exception 'INVALID_ENTITY_KIND'; end if;
 for r in select value from jsonb_array_elements(p_rows) order by value->>'id' loop
  if p_kind='clients' then
   select exists(select 1 from pos.clients where id=r->>'id') into exists_row;
   perform pos.require_current_capability(case when exists_row then 'customers.update' else 'customers.create' end);
   if exists_row then
    update pos.clients set nombre=r->>'nombre',tel=r->>'tel',email=r->>'email',direccion=r->>'direccion',
     talla=r->>'talla',notas=r->>'notas',nacimiento=nullif(r->>'nacimiento','')::date,
     generic=coalesce((r->>'generic')::boolean,false),sync_base_version=(r->>'sync_base_version')::bigint,
     sync_device_id=pos.assert_online_device() where id=r->>'id' returning to_jsonb(clients) into saved;
   else
    insert into pos.clients(id,nombre,tel,email,direccion,talla,notas,nacimiento,generic,sync_base_version,sync_device_id)
    values(r->>'id',r->>'nombre',r->>'tel',r->>'email',r->>'direccion',r->>'talla',r->>'notas',
     nullif(r->>'nacimiento','')::date,coalesce((r->>'generic')::boolean,false),0,pos.assert_online_device())
    returning to_jsonb(clients) into saved;
   end if;
  elsif p_kind='promotions' then
   perform pos.require_current_capability('promotions.manage');
   select exists(select 1 from pos.promotions where id=r->>'id') into exists_row;
   if exists_row then
    update pos.promotions set nombre=r->>'nombre',tipo=r->>'tipo',valor=(r->>'valor')::numeric,
     inicio=nullif(r->>'inicio','')::date,fin=nullif(r->>'fin','')::date,hora_inicio=r->>'hora_inicio',
     hora_fin=r->>'hora_fin',pausado=coalesce((r->>'pausado')::boolean,false),scope=coalesce(r->'scope','{}'),
     sync_base_version=(r->>'sync_base_version')::bigint,sync_device_id=pos.assert_online_device()
     where id=r->>'id' returning to_jsonb(promotions) into saved;
   else
    insert into pos.promotions(id,nombre,tipo,valor,inicio,fin,hora_inicio,hora_fin,pausado,scope,creado,sync_base_version,sync_device_id)
    values(r->>'id',r->>'nombre',coalesce(r->>'tipo','pct'),coalesce((r->>'valor')::numeric,0),
     nullif(r->>'inicio','')::date,nullif(r->>'fin','')::date,r->>'hora_inicio',r->>'hora_fin',
     coalesce((r->>'pausado')::boolean,false),coalesce(r->'scope','{}'),(r->>'creado')::bigint,0,pos.assert_online_device())
    returning to_jsonb(promotions) into saved;
   end if;
  else
   perform pos.require_current_capability('sellers.manage');
   if exists(select 1 from pos.online_account_requests ar where ar.target_user_id::text=r->>'id'
     and ar.state not in('completed','rejected','cancelled')
     and ar.request_id::text is distinct from current_setting('pos.online_account',true)) then
    raise exception 'ACCOUNT_TARGET_HAS_UNCONFIRMED_REQUEST' using errcode='40001'; end if;
   select to_jsonb(s) into old_profile from pos.sellers s where id=r->>'id';
   exists_row:=old_profile is not null;
   if exists_row then
    r:=old_profile||r;
    update pos.sellers set nombre=r->>'nombre',iniciales=r->>'iniciales',color=r->>'color',
     comision_pct=coalesce((r->>'comision_pct')::numeric,0),commission_override_pct=(r->>'commission_override_pct')::numeric,
     seller_level_code=r->>'seller_level_code',commission_policy_version=coalesce((r->>'commission_policy_version')::smallint,1),
     meta_mes=coalesce((r->>'meta_mes')::numeric,0),bono=r->>'bono',email=r->>'email',role=coalesce(r->>'role','vendedor'),
     avatar_url=r->>'avatar_url',active=coalesce((r->>'active')::boolean,true),
     sync_base_version=(r->>'sync_base_version')::bigint,sync_device_id=pos.assert_online_device()
     where id=r->>'id' returning to_jsonb(sellers)-'password_hash' into saved;
   else
    insert into pos.sellers(id,nombre,iniciales,color,comision_pct,commission_override_pct,seller_level_code,
     commission_policy_version,meta_mes,bono,email,role,avatar_url,active,sync_base_version,sync_device_id)
    values(r->>'id',r->>'nombre',r->>'iniciales',r->>'color',coalesce((r->>'comision_pct')::numeric,0),
     (r->>'commission_override_pct')::numeric,r->>'seller_level_code',coalesce((r->>'commission_policy_version')::smallint,1),
     coalesce((r->>'meta_mes')::numeric,0),r->>'bono',r->>'email',coalesce(r->>'role','vendedor'),r->>'avatar_url',
     coalesce((r->>'active')::boolean,true),0,pos.assert_online_device())
    returning to_jsonb(sellers)-'password_hash' into saved;
   end if;
  end if;
  if saved is null then raise exception 'ENTITY_CONFIRMATION_MISSING'; end if;
  result:=result||jsonb_build_array(saved);
 end loop;
 return result;
end $$;
revoke all on function pos.online_save_entities(text,jsonb) from public,anon,authenticated;

-- Opaque quote precondition. Aggregate counters are deliberately excluded:
-- another sale changes balances, but cannot change an already agreed price.
create function pos.online_quote_context() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pos,auth as $$
declare quote_at timestamp:=coalesce(nullif(current_setting('pos.online_quote_clock',true),'')::timestamptz,statement_timestamp()) at time zone 'America/Hermosillo';
begin
 if auth.uid() is null or not(pos.is_active_admin() or pos.is_active_seller()) then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 return jsonb_build_object(
  'configVersion',coalesce((select version from pos.config_sync_state where singleton),0),
  'promotionsFingerprint',(select md5(coalesce(jsonb_agg(jsonb_build_array(id,sync_version,deleted_at) order by id),'[]')::text) from pos.promotions),
  'sellersFingerprint',(select md5(coalesce(jsonb_agg(jsonb_build_array(id,active,deleted_at,comision_pct,
   commission_override_pct,seller_level_code,commission_policy_version) order by id),'[]')::text) from pos.sellers),
  'financialFingerprint',md5(jsonb_build_array(
   (select coalesce(jsonb_agg(jsonb_build_array(folio,fecha,estado,comisiones) order by folio),'[]') from pos.sales),
   (select coalesce(jsonb_agg(jsonb_build_array(id,fecha,comisiones) order by id),'[]') from pos.returns),
   (select coalesce(jsonb_agg(jsonb_build_array(id,fecha,vendedor_id,comision_base_importe,comision_revertida) order by id),'[]') from pos.exchanges),
   (select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') from pos.liquidations l)
  )::text),
  'businessTimeZone','America/Hermosillo',
  'promotionWindowFingerprint',(select md5(coalesce(jsonb_agg(jsonb_build_array(id,
   case when pausado then 'Pausado'
    when inicio is not null and quote_at<inicio+coalesce(nullif(hora_inicio,''),'00:00')::time then 'Programado'
    when fin is not null and quote_at>fin+coalesce(nullif(hora_fin,''),'23:59')::time then 'Finalizado'
    else 'Activo' end) order by id),'[]')::text) from pos.promotions where deleted_at is null)
 );
end $$;
revoke all on function pos.online_quote_context() from public,anon,authenticated;
grant execute on function pos.online_quote_context() to authenticated;

create function pos.dispatch_online_command(p_request_id uuid,p_command jsonb,p_depth integer default 0) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare
 k text:=p_command->>'type'; domain text:=p_command->>'kind'; r jsonb; x jsonb;
 m pos.system_manifest%rowtype; d text; a jsonb; n integer:=0; old_row jsonb; child_result jsonb;
begin
 if not pos.online_request_context() then raise exception 'ONLINE_COMMAND_REQUIRED' using errcode='42501'; end if;
 d:=pos.assert_online_device();
 select * into m from pos.system_manifest where singleton for share;
 if p_command ? 'accountRequestId' then p_command:=pos.online_account_profile_command(p_command); end if;
 case k
 when 'batch','sizeMigration' then
  if k='sizeMigration' and (exists(select 1 from pos.sales) or exists(select 1 from pos.returns)
   or exists(select 1 from pos.exchanges) or exists(select 1 from pos.loan_documents where deleted_at is null)
   or exists(select 1 from pos.movements) or exists(select 1 from pos.sale_payments)) then
   raise exception 'SIZE_MIGRATION_HAS_COMMERCIAL_HISTORY' using errcode='23514'; end if;
  if p_depth<>0 or jsonb_typeof(p_command->'commands')<>'array' or jsonb_array_length(p_command->'commands') not between 1 and 200 then
   raise exception 'INVALID_COMMAND_BATCH' using errcode='22023'; end if;
  r:='[]';
  for x in select value from jsonb_array_elements(p_command->'commands') loop
   n:=n+1; r:=r||jsonb_build_array(pos.dispatch_online_command(md5(p_request_id::text||':'||n)::uuid,x,p_depth+1));
  end loop;
 when 'upsert' then
  if domain='products' then
   perform pos.online_check_rows('products',p_command->'rows');
   if coalesce((p_command->>'familyBatch')::boolean,false) then
    r:=pos.commit_reference_family_batch(p_request_id,(p_command->>'referenceFamilyId')::uuid,p_command->'rows',m.sync_protocol_current,m.data_epoch);
   else r:=pos.save_products_checked_v2(p_request_id,p_command->'rows',m.sync_protocol_current,m.data_epoch); end if;
  else r:=pos.online_save_entities(domain,p_command->'rows'); end if;
 when 'profileUpdate','staffUpdate' then
  if domain is distinct from 'sellers' then raise exception 'INVALID_PROFILE_KIND'; end if;
  r:=pos.online_save_entities('sellers',p_command->'rows');
 when 'softDelete' then
  if domain='products' then
   r:=pos.delete_product_checked_v2(p_request_id,p_command->>'val',(p_command->>'baseVersion')::bigint,d,m.sync_protocol_current,m.data_epoch);
  elsif domain in('clients','sellers','promotions') then
   perform pos.require_current_capability(case domain when 'clients' then 'customers.delete' when 'sellers' then 'sellers.manage' else 'promotions.manage' end);
   if domain='sellers' and exists(select 1 from pos.online_account_requests ar where ar.target_user_id::text=p_command->>'val'
     and ar.state not in('completed','rejected','cancelled')
     and ar.request_id::text is distinct from current_setting('pos.online_account',true)) then
    raise exception 'ACCOUNT_TARGET_HAS_UNCONFIRMED_REQUEST' using errcode='40001'; end if;
   perform pos.online_check_rows(domain,jsonb_build_array(jsonb_build_object('id',p_command->>'val','sync_base_version',(p_command->>'baseVersion')::bigint)));
   r:=pos.soft_delete_entity(domain,p_command->>'val',(p_command->>'baseVersion')::bigint,d);
  else raise exception 'INVALID_DELETE_KIND'; end if;
 when 'productDeleteScope' then
  r:=pos.delete_products_checked_v2(p_request_id,p_command->>'scope',(p_command->>'referenceFamilyId')::uuid,
   p_command->'targets',d,m.sync_protocol_current,m.data_epoch);
 when 'clearInventory' then
  perform pos.require_current_capability('inventory.delete');
  if jsonb_typeof(p_command->'targets') is distinct from 'array' then raise exception 'INVALID_INVENTORY_DELETE_SCOPE'; end if;
  if (select count(*) from pos.products where deleted_at is null)<>jsonb_array_length(p_command->'targets')
   or exists(select 1 from pos.products p where p.deleted_at is null and not exists(
    select 1 from jsonb_array_elements(p_command->'targets') t where t->>'id'=p.id)) then
   raise exception 'INVENTORY_SCOPE_CHANGED' using errcode='40001'; end if;
  r:='[]';
  for x in select value from jsonb_array_elements(p_command->'targets') order by value->>'id' loop
   n:=n+1;
   child_result:=pos.delete_products_checked_v2(md5(p_request_id::text||':'||n)::uuid,
    'reference',null,jsonb_build_array(x),d,m.sync_protocol_current,m.data_epoch);
   if child_result is null or child_result='false'::jsonb or child_result->>'ok'='false' then raise exception 'INVENTORY_DELETE_NOT_CONFIRMED'; end if;
   r:=r||jsonb_build_array(child_result);
  end loop;
 when 'config' then
  r:=pos.commit_config(p_request_id::text,(p_command->>'expectedVersion')::bigint,d,p_command->'lookup',p_command->'settings',m.sync_protocol_current,m.data_epoch);
  if r->>'ok'='false' then raise exception using message=coalesce(r->>'error','CONFIG_REJECTED'); end if;
  if jsonb_typeof(p_command->'productUpdates')='array' and jsonb_array_length(p_command->'productUpdates')>0 then
   perform pos.online_check_rows('products',p_command->'productUpdates');
   child_result:=pos.save_products_checked_v2(md5(p_request_id::text||':products')::uuid,p_command->'productUpdates',m.sync_protocol_current,m.data_epoch);
   if child_result is null or child_result='false'::jsonb or child_result->>'ok'='false' then raise exception 'CONFIG_PRODUCTS_NOT_CONFIRMED'; end if;
  end if;
 when 'sale' then
  if coalesce(p_command->>'mode','')<>'layaway_liquidation' then
   select to_jsonb(s) into old_row from pos.sales s where folio=p_command#>>'{header,folio}' for update;
   if p_command->>'mode'='payment' then
    a:=p_command->'expectedSale';
    if old_row is null or jsonb_typeof(a) is distinct from 'object'
     or not a ?& array['estado','anticipo','saldo','pago_efectivo','pago_otro','operation_id']
     or exists(select 1 from unnest(array['estado','anticipo','saldo','pago_efectivo','pago_otro','operation_id']) key
      where coalesce(old_row->key,'null'::jsonb) is distinct from coalesce(a->key,'null'::jsonb)) then
     raise exception 'SALE_VERSION_CONFLICT' using errcode='40001'; end if;
   elsif old_row is not null then
    raise exception 'SALE_ALREADY_EXISTS' using errcode='40001';
   else
    if p_command->'quoteContext' is distinct from pos.online_quote_context() then
     raise exception 'COMMERCIAL_QUOTE_CHANGED' using errcode='40001'; end if;
    a:=p_command->'expectedProducts';
    if jsonb_typeof(a) is distinct from 'array' or jsonb_array_length(a)=0
     or exists(select 1 from jsonb_array_elements(p_command->'items') line where not exists(
      select 1 from jsonb_array_elements(a) expected where expected->>'id'=line->>'product_id')) then
     raise exception 'SALE_PRODUCT_BASE_REQUIRED' using errcode='22023'; end if;
    for x in select value from jsonb_array_elements(a) order by value->>'id' loop
     if not exists(select 1 from pos.products p where p.id=x->>'id' and p.deleted_at is null
      and p.sync_version=coalesce(x->>'version',x->>'baseVersion')::bigint) then
      raise exception 'SALE_PRODUCT_VERSION_CONFLICT' using errcode='40001'; end if;
    end loop;
   end if;
  end if;
  if p_command->>'mode'='layaway_liquidation' then
   r:=pos.commit_layaway_liquidation_checked(p_request_id::text,coalesce(p_command->>'saleOperationId',p_command->>'operationId'),p_command->>'folio',
    p_command->'payment',coalesce(p_command->'sellerEffects','[]'),
    jsonb_build_object('item_identities',coalesce(p_command->'itemIdentities','[]'),
     'commission_amount',coalesce(p_command#>'{commissionSnapshot,amount}','0'),
     'commission_base',coalesce(p_command#>'{commissionSnapshot,base}','"neto"'),
     'commission_rows',coalesce(p_command#>'{commissionSnapshot,rows}','[]')));
  elsif jsonb_typeof(p_command#>'{header,descuentos_adicionales}')='array' then
   r:=pos.commit_sale_with_additional_discount_checked(p_request_id::text,p_command->>'operationId',p_command->'header',
    coalesce(p_command->'items','[]'),coalesce(p_command->'moves','[]'),coalesce(p_command->'payments','[]'),
    coalesce(p_command->'stockLines','[]'),coalesce((p_command->>'reserveStock')::boolean,false),
    p_command->'clientEffect',coalesce(p_command->'sellerEffects','[]'));
  else
   r:=pos.commit_sale_checked(p_request_id::text,p_command->>'operationId',p_command->'header',
    coalesce(p_command->'items','[]'),coalesce(p_command->'moves','[]'),coalesce(p_command->'payments','[]'),
    coalesce(p_command->'stockLines','[]'),coalesce((p_command->>'reserveStock')::boolean,false),
    p_command->'clientEffect',coalesce(p_command->'sellerEffects','[]'));
  end if;
 when 'return' then
  if coalesce((p_command->>'legacy')::boolean,false) then
   raise exception 'LEGACY_REPLAY_RETIRED' using errcode='22023';
  end if;
  r:=pos.commit_return_checked(p_request_id::text,p_command->'header',coalesce(p_command->'items','[]'),
   coalesce(p_command->'moves','[]'),coalesce(p_command->'stockLines','[]'),p_command->'clientEffect',coalesce(p_command->'sellerEffects','[]'),false);
 when 'exchange' then
  if p_command->'quoteContext' is distinct from pos.online_quote_context() then
   raise exception 'COMMERCIAL_QUOTE_CHANGED' using errcode='40001'; end if;
  a:=p_command->'expectedProducts';
  if jsonb_typeof(a) is distinct from 'array' or jsonb_array_length(a)=0
   or exists(select 1 from jsonb_array_elements(p_command->'items') line where line->>'lado'='entregado' and not exists(
    select 1 from jsonb_array_elements(a) expected where expected->>'id'=line->>'product_id')) then
   raise exception 'EXCHANGE_PRODUCT_BASE_REQUIRED' using errcode='22023'; end if;
  for x in select value from jsonb_array_elements(a) order by value->>'id' loop
   if not exists(select 1 from pos.products p where p.id=x->>'id' and p.deleted_at is null
    and p.sync_version=coalesce(x->>'version',x->>'baseVersion')::bigint) then
    raise exception 'EXCHANGE_PRODUCT_VERSION_CONFLICT' using errcode='40001'; end if;
  end loop;
  r:=pos.commit_exchange_checked(p_request_id::text,p_command->'header',coalesce(p_command->'items','[]'),
   coalesce(p_command->'moves','[]'),p_command->'payment',coalesce(p_command->'seller_effects','[]'));
 when 'loanOperation' then
  if p_command->>'action' in('deliver','edit') and exists(
   select 1 from jsonb_array_elements(p_command#>'{loan,lineas}') line
   where not exists(select 1 from pos.products p where p.id=coalesce(line->>'productId',line->>'product_id') and p.deleted_at is null)
  ) then raise exception 'LOAN_PRODUCT_NOT_FOUND' using errcode='23514'; end if;
  r:=pos.commit_loan_operation(p_request_id,p_command->>'action',p_command->'loan',coalesce((p_command->>'expectedVersion')::bigint,0));
 when 'referenceReclassification' then
  r:=pos.commit_reference_reclassification(p_request_id::text,p_command->>'sourceProductId',p_command->>'targetProductId',
   (p_command->>'quantity')::integer,p_command->>'actor',p_command->>'reason',p_command->>'reversalOf');
 when 'commissionSettle' then r:=pos.settle_commission_checked(p_request_id,p_command->>'sellerId');
 when 'commissionClose' then r:=pos.close_commission_period_checked(p_request_id);
 when 'commissionAdjustment' then r:=pos.apply_commission_adjustment_checked(p_request_id,coalesce(p_command->'rows','[]'),coalesce(p_command->>'motivo',''));
 when 'folio' then
  r:=pos.reserve_folio_block(p_command->>'prefix',case when p_command->>'businessDate' ~ '^\d{6}$' then to_date(p_command->>'businessDate','YYMMDD') else (p_command->>'businessDate')::date end,1,coalesce((p_command->>'floor')::integer,0));
  if r->>'ok'='true' then r:=r||jsonb_build_object('folio',(r->>'prefix')||'-'||to_char((r->>'business_date')::date,'YYMMDD')||'-'||lpad(r->>'from',greatest(case when p_command->>'documentKind'='loan' then 3 else 4 end,length(r->>'from')),'0')); end if;
 when 'physicalCard','physicalCardClaim' then
  r:=to_jsonb(pos.claim_physical_card(p_command->>'folio',p_command->>'claimToken'));
 when 'deviceUpdate' then
  r:=to_jsonb(pos.admin_update_sync_device(p_command->>'deviceId',p_command->>'displayName',p_command->>'deviceType'));
 when 'deviceRetire' then
  r:=to_jsonb(pos.admin_set_sync_device_retired(p_command->>'deviceId',(p_command->>'retired')::boolean,p_command->>'note'));
 when 'pointZeroBackup' then
  r:=pos.create_point_zero_backup(p_command->>'previewToken',
   (coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-client-build',d);
 when 'pointZero' then
  r:=pos.execute_point_zero(coalesce(p_command->>'operationId',p_request_id::text),p_command->>'previewToken',
   (p_command->>'backupId')::uuid,p_command->>'confirmation',
   (coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-client-build',d);
 when 'cleanupBackup' then
  r:=pos.create_test_data_cleanup_backup(p_command->>'preset',p_command->'selection',p_command->>'planHash',6,
   (coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-client-build',d);
 when 'cleanup' then
  r:=pos.execute_test_data_cleanup(coalesce(p_command->>'operationId',p_request_id::text),p_command->>'preset',p_command->'selection',
   p_command->>'planHash',(p_command->>'backupId')::uuid,p_command->>'confirmation',6,
   (coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-client-build',d);
 when 'permissions' then
  a:=p_command->'args';
  if p_command->>'rpc'='admin_sync_screen_permission_catalog' then
   r:=to_jsonb(pos.admin_sync_screen_permission_catalog(a->'p_entries',(a->>'p_expected_version')::bigint));
  elsif p_command->>'rpc'='admin_apply_user_screen_permissions_checked' then
   r:=to_jsonb(pos.admin_apply_user_screen_permissions_checked((a->>'p_target_user_id')::uuid,a->>'p_role_code',a->'p_overrides',
    a->>'p_expected_version',array(select jsonb_array_elements_text(a->'p_screen_keys'))));
  else raise exception 'UNKNOWN_PERMISSION_COMMAND' using errcode='22023'; end if;
 else raise exception using errcode='22023',message='UNKNOWN_ONLINE_COMMAND',detail=coalesce(k,'null');
 end case;
 if r is null or r='false'::jsonb or r->>'ok'='false' then
  raise exception using errcode='P0001',message=coalesce(r->>'error','OPERATION_NOT_CONFIRMED'),detail=coalesce(r::text,'null');
 end if;
 return r;
end $$;
revoke all on function pos.dispatch_online_command(uuid,jsonb,integer) from public,anon,authenticated;

create function pos.execute_online_command(p_request_id uuid,p_command jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare v_actor uuid:=auth.uid(); d text; h text; prior pos.online_requests%rowtype;
 v_response jsonb; result jsonb; ec text; em text; ed text;
begin
 d:=pos.assert_online_device();
 if p_request_id is null or jsonb_typeof(p_command) is distinct from 'object' then raise exception 'INVALID_ONLINE_REQUEST' using errcode='22023'; end if;
 if nullif(p_command->>'expectedActorId','')::uuid is distinct from v_actor then raise exception 'ONLINE_ACTOR_CHANGED' using errcode='42501'; end if;
 h:=encode(extensions.digest(convert_to(p_command::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('pos.online.request:'||v_actor::text||':'||p_request_id::text,164));
 select * into prior from pos.online_requests where actor_id=v_actor and request_id=p_request_id;
 if found then
  if prior.command_hash is not null and prior.command_hash<>h then raise exception 'REQUEST_PAYLOAD_MISMATCH' using errcode='22023'; end if;
  if prior.state='executing' then raise exception 'REQUEST_RESULT_UNCERTAIN'; end if;
  return prior.response;
 end if;
 insert into pos.online_requests(actor_id,request_id,command_hash,command_kind,device_id,state)
 values(v_actor,p_request_id,h,p_command->>'type',d,'executing');
 perform set_config('pos.online_request',p_request_id::text,true);
 -- Three tills share a short server transaction. This lock also covers cross-
 -- domain dependencies whose historical RPCs used unrelated lock namespaces.
 perform pg_advisory_xact_lock(hashtextextended('pos.online.commercial',164));
 perform set_config('pos.online_quote_clock',clock_timestamp()::text,true);
 begin
  result:=pos.dispatch_online_command(p_request_id,p_command);
  set constraints all immediate;
  v_response:=jsonb_build_object('ok',true,'requestId',p_request_id,'result',result);
 exception when others then
  get stacked diagnostics ec=RETURNED_SQLSTATE,em=MESSAGE_TEXT,ed=PG_EXCEPTION_DETAIL;
  v_response:=jsonb_build_object('ok',false,'requestId',p_request_id,'error',jsonb_build_object('code',ec,'message',em,'details',nullif(ed,'')));
 end;
 update pos.online_requests set state=case when v_response->>'ok'='true' then 'confirmed' else 'rejected' end,
  response=v_response,completed_at=clock_timestamp() where actor_id=v_actor and request_id=p_request_id;
 perform set_config('pos.online_request','',true);
 perform set_config('pos.online_quote_clock','',true);
 return v_response;
end $$;
revoke all on function pos.execute_online_command(uuid,jsonb) from public,anon,authenticated;
grant execute on function pos.execute_online_command(uuid,jsonb) to authenticated;

-- Resolving an absent request records a terminal cancellation under the SAME
-- lock as execution. A delayed HTTP request can never commit after this answer.
create function pos.resolve_online_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare v_actor uuid:=auth.uid(); response jsonb;
begin
 if v_actor is null or not(pos.is_active_admin() or pos.is_active_seller()) then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 if p_request_id is null then raise exception 'INVALID_REQUEST_ID' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('pos.online.request:'||v_actor::text||':'||p_request_id::text,164));
 select r.response into response from pos.online_requests r where actor_id=v_actor and request_id=p_request_id;
 if found then
  if response is null then raise exception 'REQUEST_RESULT_UNCERTAIN'; end if;
  return response;
 end if;
 response:=jsonb_build_object('ok',false,'requestId',p_request_id,'notExecuted',true,
  'error',jsonb_build_object('code','REQUEST_NOT_EXECUTED','message','La operación no se confirmó. Puedes volver a intentarlo.'));
 insert into pos.online_requests(actor_id,request_id,state,response,completed_at)
 values(v_actor,p_request_id,'cancelled',response,clock_timestamp());
 return response;
end $$;
revoke all on function pos.resolve_online_request(uuid) from public,anon,authenticated;
grant execute on function pos.resolve_online_request(uuid) to authenticated;

-- Read-before-send may find a committed receipt without cancelling a request
-- that has never been submitted. Uncertain submissions use the resolver above.
create function pos.online_request_result(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pos,auth as $$
declare r jsonb;
begin
 if auth.uid() is null or not(pos.is_active_admin() or pos.is_active_seller()) then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 select response into r from pos.online_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then return jsonb_build_object('found',true,'receipt',r); end if;
 return jsonb_build_object('found',false);
end $$;
revoke all on function pos.online_request_result(uuid) from public,anon,authenticated;
grant execute on function pos.online_request_result(uuid) to authenticated;

create function pos.online_presence(p_device_id text,p_client_build text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare r pos.sync_devices%rowtype; h jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
begin
 if auth.uid() is null or not(pos.is_active_admin() or pos.is_active_seller()) then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 if nullif(p_device_id,'') is null or p_device_id is distinct from h->>'x-balam-device-id' then raise exception 'DEVICE_ID_REQUIRED' using errcode='22023'; end if;
 insert into pos.sync_devices(device_id,user_id,user_email,client_build,protocol_version,schema_version,data_epoch,cursors,queue_pending,queue_blocked,status,last_seen_at,last_synced_at,metadata)
 select p_device_id,auth.uid(),auth.jwt()->>'email',p_client_build,m.sync_protocol_current,m.schema_version,m.data_epoch,'{}',0,0,'online',now(),now(),'{"online_only":true}'::jsonb
 from pos.system_manifest m where singleton
 on conflict(device_id) do update set user_id=excluded.user_id,user_email=excluded.user_email,client_build=excluded.client_build,
  last_seen_at=now(),status=case when pos.sync_devices.status='revoked' then 'revoked' else 'online' end,
  metadata=pos.sync_devices.metadata||jsonb_build_object('online_only',true,'reactivation_requires_sync',false,
   'legacy_queue_pending',coalesce(pos.sync_devices.metadata->'legacy_queue_pending',to_jsonb(pos.sync_devices.queue_pending)),
   'legacy_queue_blocked',coalesce(pos.sync_devices.metadata->'legacy_queue_blocked',to_jsonb(pos.sync_devices.queue_blocked))),
  queue_pending=0,queue_blocked=0,cursors='{}'
 returning * into r;
 return jsonb_build_object('ok',r.device_id is not null and r.status<>'revoked','retired',r.status='revoked','deviceId',r.device_id,'contractVersion',1,'serverTime',clock_timestamp());
end $$;
revoke all on function pos.online_presence(text,text) from public,anon,authenticated;
grant execute on function pos.online_presence(text,text) to authenticated;

create function pos.online_connectivity() returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare d text;
begin
 d:=pos.assert_online_device();
 return jsonb_build_object('ok',true,'deviceId',d,'contractVersion',1,'serverTime',clock_timestamp());
end $$;
revoke all on function pos.online_connectivity() from public,anon,authenticated;
grant execute on function pos.online_connectivity() to authenticated;

-- Auth account administration spans GoTrue and PostgreSQL. This server-owned
-- receipt holds only nonsecret profile intent and evidence; never passwords.
-- It is not an offline queue and has no timer or automatic replay consumer.
create table pos.online_account_requests (
 actor_id uuid not null,
 request_id uuid not null,
 action text not null check(action in('create','update','delete')),
 payload_hash text not null,
 payload jsonb not null,
 base_profile jsonb,
 state text not null default 'prepared' check(state in('prepared','auth_confirmed','profile_confirmed','completed','needs_review','rejected','cancelled')),
 target_user_id uuid,
 result jsonb,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_id),
 check(not payload ?| array['password','passwordHash','password_hash','access_token','refresh_token'])
);
alter table pos.online_account_requests enable row level security;
revoke all on pos.online_account_requests from public,anon,authenticated;
grant all on pos.online_account_requests to service_role;

create function pos.prepare_online_account(p_request_id uuid,p_actor_id uuid,p_payload jsonb,p_payload_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare r pos.online_account_requests%rowtype; base_profile jsonb; expected_base bigint;
begin
 if p_request_id is null or p_actor_id is null or nullif(p_payload_hash,'') is null
  or jsonb_typeof(p_payload) is distinct from 'object' or p_payload ?| array['password','passwordHash','password_hash','access_token','refresh_token'] then
  raise exception 'INVALID_ACCOUNT_REQUEST' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('pos.online.account:'||p_actor_id::text||':'||p_request_id::text,164));
 select * into r from pos.online_account_requests where actor_id=p_actor_id and request_id=p_request_id;
 if found then
  if r.state='cancelled' then return to_jsonb(r); end if;
  if r.payload_hash<>p_payload_hash or r.payload<>p_payload then raise exception 'ACCOUNT_REQUEST_MISMATCH' using errcode='22023'; end if;
  return to_jsonb(r);
 end if;
 -- Reserve the target under the same short transaction boundary as profile
 -- commands, so a concurrent delete cannot pass its pending check beforehand.
 perform pg_advisory_xact_lock(hashtextextended('pos.online.commercial',164));
 perform pg_advisory_xact_lock(hashtextextended('pos.online.account.target:'||coalesce(nullif(p_payload->>'id',''),lower(p_payload->>'email')),164));
 if exists(select 1 from pos.online_account_requests a where a.state not in('completed','rejected','cancelled')
  and ((nullif(p_payload->>'id','') is not null and a.target_user_id::text=p_payload->>'id')
   or (nullif(p_payload->>'email','') is not null and lower(a.payload->>'email')=lower(p_payload->>'email')))) then
  raise exception 'ACCOUNT_TARGET_HAS_UNCONFIRMED_REQUEST' using errcode='40001'; end if;
 if nullif(p_payload->>'id','') is not null then
  select to_jsonb(s)-array['password_hash','sync_version','sync_base_version','sync_device_id','updated_at','ventas_mes','ventas_num','comision_acum']
   into base_profile from pos.sellers s where s.id=p_payload->>'id' and s.deleted_at is null for update;
  expected_base:=coalesce((p_payload#>>'{profileCommand,rows,0,sync_base_version}')::bigint,(p_payload#>>'{profileCommand,baseVersion}')::bigint);
  if base_profile is null or expected_base is null or expected_base is distinct from(select sync_version from pos.sellers where id=p_payload->>'id') then
   raise exception 'ENTITY_VERSION_CONFLICT' using errcode='40001'; end if;
 end if;
 insert into pos.online_account_requests(actor_id,request_id,action,payload_hash,payload,target_user_id,base_profile)
 values(p_actor_id,p_request_id,p_payload->>'action',p_payload_hash,p_payload,nullif(p_payload->>'id','')::uuid,base_profile) returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function pos.prepare_online_account(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function pos.prepare_online_account(uuid,uuid,jsonb,text) to service_role;

create function pos.advance_online_account(p_request_id uuid,p_actor_id uuid,p_state text,p_target_user_id uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare r pos.online_account_requests%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('pos.online.account:'||p_actor_id::text||':'||p_request_id::text,164));
 select * into r from pos.online_account_requests where actor_id=p_actor_id and request_id=p_request_id for update;
 if not found then raise exception 'ACCOUNT_REQUEST_NOT_FOUND'; end if;
 if p_state is null or p_state not in('auth_confirmed','profile_confirmed','completed','needs_review','rejected') then raise exception 'INVALID_ACCOUNT_STATE'; end if;
 if r.target_user_id is not null and p_target_user_id is not null and r.target_user_id<>p_target_user_id then raise exception 'ACCOUNT_TARGET_MISMATCH'; end if;
 if r.state in('completed','rejected','cancelled') then
  return to_jsonb(r);
 end if;
 if r.state in('auth_confirmed','profile_confirmed') and p_state='prepared' then return to_jsonb(r); end if;
 if r.state='profile_confirmed' and p_state='auth_confirmed' then return to_jsonb(r); end if;
 if p_state='completed' and (p_result->>'ok') is distinct from 'true' then raise exception 'ACCOUNT_CONFIRMATION_REQUIRED'; end if;
 update pos.online_account_requests set state=p_state,target_user_id=coalesce(target_user_id,p_target_user_id),
  result=coalesce(p_result,result),updated_at=clock_timestamp() where actor_id=p_actor_id and request_id=p_request_id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function pos.advance_online_account(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function pos.advance_online_account(uuid,uuid,text,uuid,jsonb) to service_role;

create function pos.online_account_result(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare r pos.online_account_requests%rowtype;
begin
 if auth.uid() is null or not(pos.is_active_admin() or pos.is_active_seller()) then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 if p_request_id is null then raise exception 'INVALID_REQUEST_ID' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('pos.online.account:'||auth.uid()::text||':'||p_request_id::text,164));
 select * into r from pos.online_account_requests where actor_id=auth.uid() and request_id=p_request_id;
 if not found then
  insert into pos.online_account_requests(actor_id,request_id,action,payload_hash,payload,state,result)
  values(auth.uid(),p_request_id,'update','','{}','cancelled',jsonb_build_object('ok',false,'notExecuted',true,'error','ACCOUNT_REQUEST_NOT_EXECUTED')) returning * into r;
 end if;
 return jsonb_build_object('ok',r.state='completed','state',r.state,'requestId',r.request_id,'targetUserId',r.target_user_id,'result',r.result);
end $$;
revoke all on function pos.online_account_result(uuid) from public,anon,authenticated;
grant execute on function pos.online_account_result(uuid) to authenticated;

create function pos.online_account_profile_command(p_command jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare ar pos.online_account_requests%rowtype; expected jsonb; live_profile jsonb; v bigint; target text;
begin
 if not pos.online_request_context() then raise exception 'ONLINE_COMMAND_REQUIRED' using errcode='42501'; end if;
 select * into ar from pos.online_account_requests where actor_id=auth.uid() and request_id=(p_command->>'accountRequestId')::uuid for update;
 if not found or ar.state not in('prepared','auth_confirmed','profile_confirmed') then raise exception 'ACCOUNT_REQUEST_NOT_EXECUTABLE'; end if;
 if ar.action<>'delete' and ar.state='prepared' then raise exception 'ACCOUNT_AUTH_CONFIRMATION_REQUIRED'; end if;
 target:=coalesce(ar.target_user_id::text,ar.payload->>'id');
 if target is null then raise exception 'ACCOUNT_AUTH_CONFIRMATION_REQUIRED'; end if;
 expected:=ar.payload->'profileCommand';
 if ar.action='create' then expected:=jsonb_set(expected,'{rows,0,id}',to_jsonb(target)); end if;
 if p_command is distinct from expected then raise exception 'ACCOUNT_PROFILE_COMMAND_MISMATCH'; end if;
 select to_jsonb(s)-array['password_hash','sync_version','sync_base_version','sync_device_id','updated_at','ventas_mes','ventas_num','comision_acum'],s.sync_version
  into live_profile,v from pos.sellers s where s.id=target for update;
 if live_profile is distinct from ar.base_profile then raise exception 'ACCOUNT_PROFILE_CHANGED' using errcode='40001'; end if;
 perform set_config('pos.online_account',ar.request_id::text,true);
 if p_command->>'type'='profileUpdate' then
  return jsonb_set(p_command,'{rows,0,sync_base_version}',to_jsonb(coalesce(v,0)));
 end if;
 return jsonb_set(p_command,'{baseVersion}',to_jsonb(v));
end $$;
revoke all on function pos.online_account_profile_command(jsonb) from public,anon,authenticated;

-- One statement snapshot, full collections, no durable cursor or local merge.
-- INVOKER keeps exactly the existing read policies for every role.
create function pos.online_legacy_review_count() returns bigint
language plpgsql stable security definer set search_path=pg_catalog,pos,auth as $$
begin
 if auth.uid() is null or not(pos.is_active_admin() or pos.is_active_seller()) then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 return (select count(*) from pos.online_legacy_operations where actor_id=auth.uid()
  and device_id=(coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-device-id'
  and classification='needs_review');
end $$;
revoke all on function pos.online_legacy_review_count() from public,anon,authenticated;
grant execute on function pos.online_legacy_review_count() to authenticated;

-- Existing RLS keeps return/liquidation histories private to their allowed
-- roles. Quotes need their aggregate contribution even for an active seller.
-- Expose no documents or customer data, only the signed base by seller.
create function pos.online_commission_context() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pos,auth as $$
declare period_start text; bases jsonb;
begin
 if auth.uid() is null or not(pos.is_active_admin() or pos.is_active_seller()) then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 select coalesce(left(max(fecha),10),'') into period_start from pos.liquidations where tipo='corte' and coalesce(fecha,'')<>'';
 with entries as (
  select c->>'sellerId' seller_id,c->>'base' raw_base from pos.sales s
   cross join lateral jsonb_array_elements(case when jsonb_typeof(s.comisiones)='array' then s.comisiones else '[]' end) c
   where s.estado is distinct from 'Cancelado' and (period_start='' or to_char(s.fecha at time zone 'UTC','YYYY-MM-DD HH24:MI')>=period_start)
  union all
  select c->>'sellerId',case when (c->>'base') ~ '^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$' then (-(c->>'base')::numeric)::text else '0' end
   from pos.returns r cross join lateral jsonb_array_elements(case when jsonb_typeof(r.comisiones)='array' then r.comisiones else '[]' end) c
   where period_start='' or coalesce(r.fecha,'')>=period_start
  union all
  select vendedor_id,coalesce(comision_base_importe,0)::text from pos.exchanges
   where comision_revertida is null and (period_start='' or coalesce(fecha,'')>=period_start)
 ), totals as (
  select s.id,round(coalesce(sum(case when e.raw_base ~ '^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$' then e.raw_base::numeric else 0 end),0),2) base
   from pos.sellers s left join entries e on e.seller_id=s.id where s.deleted_at is null group by s.id
 ) select coalesce(jsonb_agg(jsonb_build_object('sellerId',id,'baseRaw',base) order by id),'[]') into bases from totals;
 return jsonb_build_object('periodStart',period_start,'sellerBases',bases);
end $$;
revoke all on function pos.online_commission_context() from public,anon,authenticated;
grant execute on function pos.online_commission_context() to authenticated;

create function pos.online_snapshot() returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,pos,auth as $$
begin
 if auth.uid() is null or not(pos.is_active_admin() or pos.is_active_seller()) then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 return jsonb_build_object(
  'contractVersion',1,'serverTime',statement_timestamp(),'legacyReviewCount',pos.online_legacy_review_count(),
  'commercialQuote',pos.online_quote_context(),
  'commissionContext',pos.online_commission_context(),
  'settings',(select coalesce(jsonb_agg(to_jsonb(t) order by key),'[]') from pos.settings t),
  'lookup',(select coalesce(jsonb_agg(to_jsonb(t) order by kind,code),'[]') from pos.lookup t),
  'configVersion',(select version from pos.config_sync_state where singleton),
  'products',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from pos.products t where deleted_at is null),
  'clients',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from pos.clients t where deleted_at is null),
  'sellers',(select coalesce(jsonb_agg(to_jsonb(t)-'password_hash' order by id),'[]') from pos.sellers t where deleted_at is null),
  'promotions',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from pos.promotions t where deleted_at is null),
  'sales',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object(
    'stock_reserved',coalesce(sr.stock_reserved,false),'reservation_operation_id',sr.reservation_operation_id,
    'stock_idempotent',false) order by t.folio),'[]') from pos.sales t
    left join lateral pos.sale_stock_reservation_status(array[t.operation_id]) sr on true),
  'saleItems',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from pos.sale_items t),
  'payments',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from pos.sale_payments t),
  'returns',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from pos.returns t),
  'returnItems',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from pos.return_items t),
  'exchanges',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from pos.exchanges t),
  'exchangeItems',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from pos.exchange_items t),
  'loans',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from pos.loan_documents t where deleted_at is null),
  'movements',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from pos.movements t),
  'liquidations',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from pos.liquidations t),
  'commissionAdjustments',(select coalesce(jsonb_agg(to_jsonb(t) order by operation_id),'[]') from pos.commission_adjustments t)
 );
end $$;
revoke all on function pos.online_snapshot() from public,anon,authenticated;
grant execute on function pos.online_snapshot() to authenticated;

-- Queue wrappers, JSON strings and IndexedDB records retain their exact original
-- source above; this walker inventories individual intents without executing them.
create function pos.online_legacy_intents(p_value jsonb,p_depth integer default 0) returns setof jsonb
language plpgsql immutable set search_path=pg_catalog,pos as $$
declare decoded jsonb; child jsonb;
begin
 if p_depth>32 then raise exception 'LEGACY_NESTING_LIMIT'; end if;
 if jsonb_typeof(p_value)='string' then
  begin decoded:=(p_value#>>'{}')::jsonb; exception when invalid_text_representation then return; end;
  return query select * from pos.online_legacy_intents(decoded,p_depth+1);
 elsif jsonb_typeof(p_value)='array' then
  for child in select value from jsonb_array_elements(p_value) loop
   return query select * from pos.online_legacy_intents(child,p_depth+1);
  end loop;
 elsif jsonb_typeof(p_value)='object' then
  if p_value->>'type' in('upsert','profileUpdate','staffUpdate','delete','softDelete','productDeleteScope','config','sale','return','exchange','loanOperation','referenceReclassification','commissionSettle','commissionClose','commissionAdjustment')
    and coalesce(p_value->>'id',p_value->>'operationId') is not null then
   return next p_value;
  else
   for child in select value from jsonb_each(p_value) loop
    return query select * from pos.online_legacy_intents(child,p_depth+1);
   end loop;
  end if;
 end if;
end $$;
revoke all on function pos.online_legacy_intents(jsonb,integer) from public,anon,authenticated;

create function pos.classify_online_legacy(p_device_id text,p_op jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare oid text:=coalesce(p_op->>'id',p_op->>'operationId'); ev jsonb; h text; confirmed boolean:=false;
begin
 if auth.uid() is null or not(pos.is_active_admin() or pos.is_active_seller()) then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 select jsonb_build_object('recoveryId',r.id,'authorization',r.authorization_reason) into ev
  from pos.sync_device_recoveries r where r.device_id=p_device_id and (oid=any(r.candidate_ids) or p_op->>'operationId'=any(r.candidate_ids)) limit 1;
 if ev is null then
  select jsonb_build_object('cleanupId',q.discarded_by_cleanup,'operationId',q.operation_id) into ev
   from pos.sync_quarantine_cases q where q.device_id=p_device_id and q.discarded_by_cleanup is not null
    and (q.operation_id=oid or coalesce(q.payload_summary->'operationIds','[]') ? oid) limit 1;
 end if;
 if ev is not null then return jsonb_build_object('status','authorized_discard','evidence',ev); end if;
 -- These hashes reproduce the corresponding immutable receipt contracts, not
 -- an inference from a document currently happening to have the same ID.
 case p_op->>'type'
 when 'config' then
  h:=md5((p_op->'lookup')::text||E'\n'||(p_op->'settings')::text);
  select exists(select 1 from pos.config_commits where operation_id=oid and payload_hash=h) into confirmed;
 when 'upsert' then
  if p_op->>'kind'='products' and not coalesce((p_op->>'familyBatch')::boolean,false) then
   h:=md5(coalesce(p_op->'submittedRows',p_op->'rows')::text);
   select exists(select 1 from pos.capability_operation_audit where operation_id::text=oid and capability_key='inventory.adjust' and payload_hash=h) into confirmed;
  end if;
 when 'loanOperation' then
  h:=md5(jsonb_build_array(p_op->>'action',p_op->'loan',coalesce((p_op->>'expectedVersion')::bigint,0))::text);
  select exists(select 1 from pos.capability_operation_audit where operation_id::text=oid and capability_key='inventory.loan.'||(p_op->>'action') and payload_hash=h) into confirmed;
 when 'sale' then
  if coalesce(p_op->>'mode','')<>'layaway_liquidation' then
   h:=md5(jsonb_build_object('operation_id',p_op->>'operationId','sale',p_op->'header','items',coalesce(p_op->'items','[]'),
    'moves',coalesce(p_op->'moves','[]'),'payments',coalesce(p_op->'payments','[]'),'stock_lines',coalesce(p_op->'stockLines','[]'),
    'reserve_stock',coalesce((p_op->>'reserveStock')::boolean,false),'client_effect',p_op->'clientEffect','seller_effects',coalesce(p_op->'sellerEffects','[]'))::text);
   select exists(select 1 from pos.sale_commits where commit_id=oid and operation_id=p_op->>'operationId' and payload_hash=h) into confirmed;
  end if;
 when 'return' then
  if not coalesce((p_op->>'legacy')::boolean,false) then
   h:=md5(jsonb_build_object('return',p_op->'header','items',coalesce(p_op->'items','[]'),'moves',coalesce(p_op->'moves','[]'),
    'stock_lines',coalesce(p_op->'stockLines','[]'),'client_effect',p_op->'clientEffect','seller_effects',coalesce(p_op->'sellerEffects','[]'),'legacy',false)::text);
   select exists(select 1 from pos.return_commits where commit_id=oid and payload_hash=h) into confirmed;
  end if;
 when 'exchange' then
  h:=md5(jsonb_build_object('exchange',p_op->'header','items',coalesce(p_op->'items','[]'),'moves',coalesce(p_op->'moves','[]'),
   'payment',coalesce(p_op->'payment','null'),'seller_effects',coalesce(p_op->'seller_effects','[]'))::text);
  select exists(select 1 from pos.exchange_commits where commit_id=coalesce(p_op->>'key',oid) and payload_hash=h) into confirmed;
 else null;
 end case;
 return jsonb_build_object('status',case when confirmed then 'confirmed' else 'needs_review' end,
  'evidence',case when confirmed then jsonb_build_object('receiptIdentity',oid,'receiptHash',h) else '{}'::jsonb end);
end $$;
revoke all on function pos.classify_online_legacy(text,jsonb) from public,anon,authenticated;

create function pos.archive_online_legacy(p_device_id text,p_entries jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare e jsonb; existing pos.online_legacy_archives%rowtype; response jsonb:='[]'; cls text; oid text; ev jsonb; op jsonb; decision jsonb; operation_count integer;
begin
 if auth.uid() is null or not(pos.is_active_admin() or pos.is_active_seller()) then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 if not pos.is_active_admin() and not exists(select 1 from pos.sync_devices where device_id=p_device_id and user_id=auth.uid()) then
  raise exception 'LEGACY_OWNER_REQUIRED' using errcode='42501'; end if;
 if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)>1000 then raise exception 'INVALID_LEGACY_ENTRIES'; end if;
 for e in select value from jsonb_array_elements(p_entries) loop
  if nullif(e->>'sourceKey','') is null or nullif(e->>'hash','') is null or jsonb_typeof(e->'original') is distinct from 'string' then raise exception 'LEGACY_EVIDENCE_REQUIRED'; end if;
  if e->>'hash' is distinct from encode(extensions.digest(convert_to(e->>'original','UTF8'),'sha256'),'hex') then
   raise exception 'LEGACY_SOURCE_HASH_MISMATCH' using errcode='22023'; end if;
  oid:=nullif(e->>'operationId','');
  cls:=case when oid is null and e->>'kind'='cache' then 'retained_history' else 'needs_review' end;
  ev:='{}';
  -- Existing named cleanup directives are the authority for authorized discard.
  -- Mere document existence is deliberately insufficient proof of confirmation.
  select jsonb_build_object('recoveryId',r.id,'authorization',r.authorization_reason) into ev
   from pos.sync_device_recoveries r where r.device_id=p_device_id and oid=any(r.candidate_ids) limit 1;
  if ev is null then
   select jsonb_build_object('cleanupId',q.discarded_by_cleanup,'caseId',q.operation_id) into ev
    from pos.sync_quarantine_cases q where q.device_id=p_device_id and q.discarded_by_cleanup is not null
     and (q.operation_id=oid or coalesce(q.payload_summary->'operationIds','[]') ? oid) limit 1;
  end if;
  if ev is not null then cls:='authorized_discard'; end if;
  insert into pos.online_legacy_archives(actor_id,device_id,source_key,source_hash,operation_id,original,original_hash,classification,evidence)
   values(auth.uid(),p_device_id,e->>'sourceKey',e->>'hash',oid,e->'original',md5((e->'original')::text),cls,coalesce(ev,'{}'))
   on conflict(actor_id,device_id,source_key,source_hash) do nothing;
  select * into existing from pos.online_legacy_archives where actor_id=auth.uid() and device_id=p_device_id and source_key=e->>'sourceKey' and source_hash=e->>'hash';
  if existing.original is distinct from e->'original' then raise exception 'LEGACY_EVIDENCE_MISMATCH'; end if;
  operation_count:=0;
  for op in select * from pos.online_legacy_intents(e->'original') loop
   operation_count:=operation_count+1;
   decision:=pos.classify_online_legacy(p_device_id,op);
   insert into pos.online_legacy_operations(actor_id,device_id,operation_id,payload_hash,original,classification,evidence)
   values(auth.uid(),p_device_id,coalesce(op->>'id',op->>'operationId'),md5(op::text),op,decision->>'status',decision->'evidence')
   on conflict(actor_id,device_id,operation_id,payload_hash) do nothing;
  end loop;
  response:=response||jsonb_build_array(jsonb_build_object('sourceKey',existing.source_key,'hash',existing.source_hash,'classification',existing.classification,'status',existing.classification,'archived',true));
 end loop;
 return jsonb_build_object('ok',true,'entries',response,'acknowledged',response,'replayed',0);
end $$;
revoke all on function pos.archive_online_legacy(text,jsonb) from public,anon,authenticated;
grant execute on function pos.archive_online_legacy(text,jsonb) to authenticated;

-- Service infrastructure activates the fence only after SQL verification and
-- the new client artifact are ready. No commercial row is deleted or rewritten.
create function pos.activate_online_only() returns jsonb
language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare f record; t record;
begin
 update pos.online_runtime set enabled=true,activated_at=coalesce(activated_at,clock_timestamp()),activated_by=coalesce(activated_by,auth.uid()) where singleton;
 -- Old clients lose every direct write privilege, including TRUNCATE (row
 -- triggers do not cover it). Reads and historical evidence remain intact.
 revoke insert,update,delete,truncate,references,trigger on all tables in schema pos from public,anon,authenticated;
 alter default privileges in schema pos revoke insert,update,delete,truncate,references,trigger on tables from public,anon,authenticated;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
  where ns.nspname='pos' and p.proname=any(array[
   'commit_reference_family_batch','reserve_sale_stock','execute_test_data_cleanup','create_test_data_cleanup_backup',
   'delete_products_checked_v2','admin_set_sync_device_retired','claim_physical_card','commit_exchange_checked',
   'commit_return_checked','h133_restore_inventory_v3_backup','soft_delete_entity','reserve_folio_block',
   'admin_apply_user_screen_permissions','admin_apply_role_screen_permissions','commit_layaway_liquidation_checked',
   'admin_sync_screen_permission_catalog','admin_apply_user_screen_permissions_checked','settle_commission_checked',
   'close_commission_period_checked','commit_loan_operation','purge_test_data','apply_commission_adjustment_checked',
   'commit_config','save_products_checked_v2','delete_product_checked_v2','admin_update_sync_device',
   'execute_point_zero','commit_reference_reclassification','commit_sale_with_additional_discount_checked',
   'commit_sale_checked','create_point_zero_backup'
  ]) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
 -- These triggers only maintained durable synchronization cursors. Realtime
 -- still receives actual table changes; refresh reads the authoritative snapshot.
 for t in select tr.tgname,cl.oid::regclass relation from pg_trigger tr
   join pg_class cl on cl.oid=tr.tgrelid join pg_namespace ns on ns.oid=cl.relnamespace
   join pg_proc p on p.oid=tr.tgfoid
   where ns.nspname='pos' and not tr.tgisinternal and p.proname=any(array[
    'touch_sync_domain','touch_sync_devices_domain','h81_touch_quarantine_devices','h80_sync_activity_material_change']) loop
  execute format('drop trigger %I on %s',t.tgname,t.relation);
 end loop;
 -- No current client or retained SQL authority calls these local-first-only
 -- endpoints. DROP without CASCADE proves dependency safety; evidence tables stay.
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
  where ns.nspname='pos' and p.proname=any(array[
   'admin_decide_sync_quarantine','consume_sync_quarantine_decisions','consume_sync_commands',
   'admin_mark_sync_activity_reviewed','admin_request_sync_retry','complete_sync_command',
   'report_sync_device','complete_sync_quarantine','report_sync_quarantine',
   'complete_sync_device_recovery','capture_sync_device_recovery','prepare_sync_device_recovery',
   'get_sync_device_recovery','establish_sync_point_zero','commit_legacy_return',
   'touch_sync_domain','touch_sync_devices_domain','h81_touch_quarantine_devices','h80_sync_activity_material_change'
 ]) loop
  execute format('drop function %s',f.signature);
 end loop;
 perform pg_notify('pgrst','reload schema');
 return jsonb_build_object('ok',true,'onlineOnly',true,'contractVersion',1);
end $$;
revoke all on function pos.activate_online_only() from public,anon,authenticated;
grant execute on function pos.activate_online_only() to service_role;

-- Online-only removes queue/epoch readiness from the existing administrative
-- wizards. Their preproduction, backup, exact preview and confirmation guards
-- remain byte-for-byte unchanged. No cleanup is executed by this migration.
do $readiness$
declare f text; start_at integer; end_at integer; segment text; marker text;
begin
 f:=pg_get_functiondef('pos.point_zero_preview()'::regprocedure);
 start_at:=position('  select coalesce(sum(queue_pending),0)' in f);
 end_at:=position('  select count(*) into v_active' in f);
 if start_at=0 or end_at<=start_at then raise exception 'H164_POINT_ZERO_PREVIEW_SOURCE_DRIFT'; end if;
 segment:=substring(f from start_at for end_at-start_at);
 f:=overlay(f placing '  if (select enabled from pos.online_runtime where singleton) then
    v_queue:=0; v_blocked:=0; v_unsynchronized:=0;
  else
'||segment||'  end if;
' from start_at for end_at-start_at);
 marker:='from pos.sync_devices d where d.status <> ''revoked''';
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_POINT_ZERO_DEVICES_SOURCE_DRIFT'; end if;
 f:=replace(f,marker,marker||' and not (select enabled from pos.online_runtime where singleton)');
 execute f;

 f:=pg_get_functiondef('pos.test_data_cleanup_fleet_risk(jsonb)'::regprocedure);
 marker:='  for v_device in';
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_CLEANUP_FLEET_SOURCE_DRIFT'; end if;
 f:=replace(f,marker,$online$  if (select enabled from pos.online_runtime where singleton) then
    v_core := (v_plan - 'ok' - 'plan_hash' - 'executable' - 'queue_pending'
      - 'active_locks' - 'unsynchronized_devices' - 'incompatible_devices')
      || jsonb_build_object('protocol_version',6,'minimum_client_protocol',5,
        'quarantine_discard','[]'::jsonb,'blocked_reasons',v_reasons,
        'counts',coalesce(v_plan->'counts','{}'::jsonb)||jsonb_build_object('operaciones_archivadas',0),
        'fleet',jsonb_build_object('summary',jsonb_build_object(
          'ready',(select count(*) from pos.sync_devices where status<>'revoked' and metadata->>'online_only'='true'),
          'retired',(select count(*) from pos.sync_devices where status='revoked'),
          'attention',0,'unsafe_legacy',0,'historical_incidents',0,'compatible_offline',0,'update_on_return',0),
          'devices','[]'::jsonb));
    return v_core||jsonb_build_object('ok',true,'plan_hash',pos.test_data_cleanup_plan_hash(v_core),
      'executable',jsonb_array_length(v_reasons)=0,'queue_pending',0,'active_locks',0,
      'unsynchronized_devices',0,'incompatible_devices',0);
  end if;
  for v_device in$online$);
 execute f;
end $readiness$;

-- Keep only the compatibility helpers still called by administrative SQL.
-- Their online path never advances a durable synchronization cursor or asks
-- a reactivated installation to reconstruct a former local business database.
do $compatibility$
declare f text; marker text;
begin
 f:=pg_get_functiondef('pos.bump_sync_domain(text,text)'::regprocedure);
 marker:='  insert into pos.sync_domain_versions';
 if position(marker in f)=0 then raise exception 'H164_SYNC_BUMP_SOURCE_DRIFT'; end if;
 f:=replace(f,marker,'  if (select enabled from pos.online_runtime where singleton) then
    return coalesce((select version from pos.sync_domain_versions where domain=p_domain),0);
  end if;
'||marker);
 execute f;
 f:=pg_get_functiondef('pos.admin_set_sync_device_retired(text,boolean,text)'::regprocedure);
 marker:='case when p_retired then ''revoked'' else ''must_rebootstrap'' end';
 if position(marker in f)=0 then raise exception 'H164_DEVICE_RETIRE_SOURCE_DRIFT'; end if;
 f:=replace(f,marker,'case when p_retired then ''revoked'' when (select enabled from pos.online_runtime where singleton) then ''offline'' else ''must_rebootstrap'' end');
 f:=replace(f,'''reactivation_requires_sync'', not p_retired','''reactivation_requires_sync'', not p_retired and not (select enabled from pos.online_runtime where singleton)');
 execute f;
end $compatibility$;

comment on table pos.online_requests is 'H164 server transaction receipts only; no deferred execution or replay. A cancelled request cannot later execute.';
comment on table pos.online_legacy_archives is 'H164 immutable nonauthoritative migration evidence. Never consumed by a commercial replay engine.';
comment on function pos.online_snapshot() is 'H164 single PostgreSQL statement snapshot under existing invoker RLS. Every browser rebuilds from this authority.';
notify pgrst,'reload schema';
commit;

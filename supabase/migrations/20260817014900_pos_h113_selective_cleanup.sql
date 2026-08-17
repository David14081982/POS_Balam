-- POS BALAM · H-113 · Limpieza selectiva de datos de prueba.
--
-- Esta autoridad es ADITIVA y deliberadamente separada de H-98 Punto Cero. El
-- navegador solicita conceptos comerciales; PostgreSQL normaliza dependencias,
-- congela identidades y demuestra el stock objetivo antes de permitir borrar.

begin;

create table if not exists pos.test_data_cleanup_backups (
  backup_id uuid primary key default gen_random_uuid(),
  cleanup_id text,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  actor_email text,
  device_id text,
  client_build text,
  protocol_version integer not null,
  data_epoch bigint not null,
  preset text not null,
  selection_normalized jsonb not null,
  plan_hash text not null,
  payload_hash text not null,
  payload jsonb not null
);

create table if not exists pos.test_data_cleanup_operations (
  cleanup_id text primary key,
  backup_id uuid not null references pos.test_data_cleanup_backups(backup_id),
  status text not null check (status in ('running','completed','failed')),
  actor_user_id uuid not null,
  actor_email text,
  device_id text,
  client_build text,
  protocol_version integer not null,
  data_epoch_before bigint not null,
  data_epoch_after bigint,
  preset text not null,
  selection_normalized jsonb not null,
  plan_hash text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  result jsonb not null default '{}'::jsonb
);

-- Evento nuevo: un cliente H-68 jamás puede confundirlo con purga total.
create table if not exists pos.selective_cleanup_events (
  cleanup_id text primary key references pos.test_data_cleanup_operations(cleanup_id),
  protocol_version integer not null,
  minimum_client_protocol integer not null,
  preset text not null,
  selection_normalized jsonb not null,
  plan_hash text not null,
  data_epoch bigint not null,
  purged_at timestamptz not null,
  identities jsonb not null
);

alter table pos.test_data_cleanup_backups enable row level security;
alter table pos.test_data_cleanup_operations enable row level security;
alter table pos.selective_cleanup_events enable row level security;
revoke all on pos.test_data_cleanup_backups, pos.test_data_cleanup_operations,
  pos.selective_cleanup_events from public, anon, authenticated;
grant select on pos.test_data_cleanup_backups, pos.test_data_cleanup_operations,
  pos.selective_cleanup_events to authenticated;
grant all on pos.test_data_cleanup_backups, pos.test_data_cleanup_operations,
  pos.selective_cleanup_events to service_role;

drop policy if exists cleanup_backup_admin_read on pos.test_data_cleanup_backups;
create policy cleanup_backup_admin_read on pos.test_data_cleanup_backups for select
  to authenticated using (pos.is_active_admin() and pos.current_has_capability('settings.manage'));
drop policy if exists cleanup_operation_admin_read on pos.test_data_cleanup_operations;
create policy cleanup_operation_admin_read on pos.test_data_cleanup_operations for select
  to authenticated using (pos.is_active_admin() and pos.current_has_capability('settings.manage'));
drop policy if exists cleanup_event_authenticated_read on pos.selective_cleanup_events;
create policy cleanup_event_authenticated_read on pos.selective_cleanup_events for select
  to authenticated using (true);

-- La autoridad H-69 local ya congela estas dos evidencias, pero la frontera SQL
-- histórica no las persistía. Sin ellas no se puede reconstruir el saldo después
-- de una limpieza parcial: se agregan hacia adelante y NULL significa histórico
-- no demostrable (el preview se bloquea; jamás se inventa un importe).
alter table pos.returns add column if not exists comisiones jsonb;
alter table pos.sales add column if not exists comisiones_revertidas jsonb;

do $$
declare v_definition text;v_next text;
begin
  v_definition:=pg_get_functiondef('pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure);
  if position('update pos.returns set comisiones' in v_definition)=0 then
    v_next:=replace(v_definition,
      'perform pos.h94_assert_v2_document_items(p_items);',
      'perform pos.h94_assert_v2_document_items(p_items);'||E'\n  '||
      'if p_return ? ''comisiones'' and p_return->''comisiones''<>''null''::jsonb and jsonb_typeof(p_return->''comisiones'')<>''array'' then return jsonb_build_object(''ok'',false,''error'',''invalid_commission_snapshot''); end if;');
    v_next:=replace(v_next,
      'if coalesce((r->>''ok'')::boolean,false) then perform pos.h94_persist_return_references(p_return->>''id'',p_items); end if; return r;',
      'if coalesce((r->>''ok'')::boolean,false) then perform pos.h94_persist_return_references(p_return->>''id'',p_items); update pos.returns set comisiones=case when p_return ? ''comisiones'' then p_return->''comisiones'' else comisiones end where id=p_return->>''id''; end if; return r;');
    if v_next=v_definition or position('update pos.returns set comisiones' in v_next)=0 then
      raise exception 'H113_RETURN_COMMISSION_PATCH_MISMATCH';
    end if;
    execute v_next;
  end if;

  v_definition:=pg_get_functiondef('pos.h83_commit_sale_delegate(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)'::regprocedure);
  if position('comisiones_revertidas = case' in v_definition)=0 then
    v_next:=replace(v_definition,
      'if nullif(trim(p_operation_id), '''') is not null then',
      'if p_sale ? ''comisiones_revertidas'' and p_sale->''comisiones_revertidas''<>''null''::jsonb and jsonb_typeof(p_sale->''comisiones_revertidas'')<>''array'' then return jsonb_build_object(''ok'',false,''error'',''invalid_commission_snapshot''); end if;'||E'\n  '||
      'if nullif(trim(p_operation_id), '''') is not null then');
    v_next:=replace(v_next,
      'comisiones = case when p_sale ? ''comisiones''
        then p_sale -> ''comisiones'' else comisiones end',
      'comisiones = case when p_sale ? ''comisiones''
        then p_sale -> ''comisiones'' else comisiones end,
        comisiones_revertidas = case when p_sale ? ''comisiones_revertidas''
        then p_sale -> ''comisiones_revertidas'' else comisiones_revertidas end');
    if v_next=v_definition or position('comisiones_revertidas = case' in v_next)=0 then
      raise exception 'H113_SALE_COMMISSION_PATCH_MISMATCH';
    end if;
    execute v_next;
  end if;
end;
$$;

-- Plan privado. `p_selection` sólo acepta grupos semánticos; las tablas hijas
-- nunca son parámetros públicos. V1 puede usar el SKU sólo cuando resuelve a una
-- única referencia V1; V2 exige products.id, incluso con SKU aparentemente único.
create or replace function pos.test_data_cleanup_plan(
  p_preset text default 'operations', p_selection jsonb default '{}'::jsonb
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, pos, extensions
as $$
declare
  v_preset text := lower(trim(coalesce(p_preset,'operations')));
  v_requested jsonb;
  v_normalized jsonb;
  v_forced jsonb := '[]'::jsonb;
  v_documents jsonb;
  v_stock jsonb;
  v_issues jsonb;
  v_counts jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_epoch bigint;
  v_mode text;
  v_queue bigint;
  v_blocked bigint;
  v_unsynchronized bigint;
  v_incompatible bigint;
  v_core jsonb;
  v_hash text;
  v_sales boolean;
  v_returns boolean;
  v_exchanges boolean;
  v_loans boolean;
  v_commissions boolean;
  v_reclassifications boolean;
  v_customers boolean;
  v_inventory boolean;
begin
  if v_preset not in ('operations','custom') then
    raise exception 'cleanup_invalid_preset' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_selection,'{}'::jsonb)) <> 'object' then
    raise exception 'cleanup_invalid_selection' using errcode='22023';
  end if;

  v_requested := case when v_preset='operations' then jsonb_build_object(
    'sales',true,'returns',true,'exchanges',true,'loans',true,'commissions',true,
    'reclassifications',false,'customers',false,'inventory_products',false)
  else jsonb_build_object(
    'sales',coalesce((p_selection->>'sales')::boolean,false),
    'returns',coalesce((p_selection->>'returns')::boolean,false),
    'exchanges',coalesce((p_selection->>'exchanges')::boolean,false),
    'loans',coalesce((p_selection->>'loans')::boolean,false),
    'commissions',coalesce((p_selection->>'commissions')::boolean,false),
    'reclassifications',coalesce((p_selection->>'reclassifications')::boolean,false),
    'customers',coalesce((p_selection->>'customers')::boolean,false),
    'inventory_products',coalesce((p_selection->>'inventory_products')::boolean,false)) end;

  v_sales := (v_requested->>'sales')::boolean;
  v_returns := (v_requested->>'returns')::boolean;
  v_exchanges := (v_requested->>'exchanges')::boolean;
  v_loans := (v_requested->>'loans')::boolean;
  v_commissions := (v_requested->>'commissions')::boolean;
  v_reclassifications := (v_requested->>'reclassifications')::boolean;
  v_customers := (v_requested->>'customers')::boolean;
  v_inventory := (v_requested->>'inventory_products')::boolean;

  -- Una venta no puede sobrevivir sin sus efectos posventa dependientes.
  if v_sales and not v_returns and exists(
    select 1 from pos.returns r join pos.sales s on s.folio=r.folio) then
    v_returns := true; v_forced := v_forced || jsonb_build_array('returns:dependent_on_sales');
  end if;
  if v_sales and not v_exchanges and exists(
    select 1 from pos.exchanges e join pos.sales s on s.folio=e.origen_folio or s.folio=e.folio) then
    v_exchanges := true; v_forced := v_forced || jsonb_build_array('exchanges:dependent_on_sales');
  end if;
  v_normalized := jsonb_build_object(
    'sales',v_sales,'returns',v_returns,'exchanges',v_exchanges,'loans',v_loans,
    'commissions',v_commissions,'reclassifications',v_reclassifications,
    'customers',v_customers,'inventory_products',v_inventory);

  select system_mode,data_epoch into strict v_mode,v_epoch from pos.system_manifest where singleton;
  select coalesce(sum(queue_pending),0),coalesce(sum(queue_blocked),0)
    into v_queue,v_blocked from pos.sync_devices;
  select count(*) into v_unsynchronized from pos.sync_devices d
   where d.data_epoch<>v_epoch or d.queue_pending<>0 or d.queue_blocked<>0
      or d.status<>'online' or d.last_seen_at<now()-interval '2 minutes';
  select count(*) into v_incompatible from pos.sync_devices d
   where d.status<>'revoked' and coalesce(d.schema_version,0)<20260817014900;

  select jsonb_build_object(
    'sale_folios',coalesce((select jsonb_agg(s.folio order by s.folio) from pos.sales s where v_sales),'[]'::jsonb),
    'sale_operation_ids',coalesce((select jsonb_agg(s.operation_id order by s.operation_id) from pos.sales s where v_sales and s.operation_id is not null),'[]'::jsonb),
    'return_ids',coalesce((select jsonb_agg(r.id order by r.id) from pos.returns r where v_returns),'[]'::jsonb),
    'exchange_ids',coalesce((select jsonb_agg(e.id order by e.id) from pos.exchanges e where v_exchanges),'[]'::jsonb),
    'loan_ids',coalesce((select jsonb_agg(l.id order by l.id) from pos.loan_documents l where v_loans),'[]'::jsonb),
    'liquidation_ids',coalesce((select jsonb_agg(l.id order by l.id) from pos.liquidations l where v_commissions),'[]'::jsonb),
    'commission_adjustment_ids',coalesce((select jsonb_agg(a.operation_id order by a.operation_id) from pos.commission_adjustments a where v_commissions),'[]'::jsonb),
    'reclassification_ids',coalesce((select jsonb_agg(r.operation_id order by r.operation_id) from pos.reference_reclassifications r where v_reclassifications),'[]'::jsonb),
    'customer_ids',coalesce((select jsonb_agg(c.id order by c.id) from pos.clients c
      where v_customers and c.generic is not true and c.deleted_at is null
        and not exists(select 1 from pos.sales s where s.cliente_id=c.id and not v_sales)),'[]'::jsonb),
    'customer_referenced',coalesce((select jsonb_agg(c.id order by c.id) from pos.clients c
      where v_customers and c.generic is not true and c.deleted_at is null
        and exists(select 1 from pos.sales s where s.cliente_id=c.id and not v_sales)),'[]'::jsonb)
  ) into v_documents;

  -- Líneas de inversión. Los préstamos están ausentes a propósito: no tocan stock.
  with sku_candidates as (
    select p.sku,min(p.id) as product_id,count(*) as n,
      count(*) filter(where p.record_model='v1') as v1_n
    from pos.products p where p.deleted_at is null and p.sku is not null group by p.sku
  ), doc_lines as (
    select 'sale'::text origin,r.folio ref,x.product_id raw_id,null::text sku,x.talla,
      x.qty::bigint delta
    from pos.stock_reservations r cross join lateral jsonb_to_recordset(r.lines)
      as x(product_id text,talla text,qty integer) where v_sales
    union all
    select 'sale',s.folio,i.product_id,i.sku,i.talla,i.qty::bigint
    from pos.sales s join pos.sale_items i on i.folio=s.folio
    where v_sales and s.estado not in ('Apartado','Cancelado')
      and not exists(select 1 from pos.stock_reservations r where r.folio=s.folio)
    union all
    select 'return',r.id,i.product_id,i.sku,i.talla,-i.qty::bigint
    from pos.returns r join pos.return_items i on i.return_id=r.id where v_returns
    union all
    select 'exchange',e.id,i.product_id,i.sku,i.talla,
      case when i.lado='devuelto' then -i.qty::bigint else i.qty::bigint end
    from pos.exchanges e join pos.exchange_items i on i.exchange_id=e.id where v_exchanges
    union all
    select 'reclassification',r.operation_id,r.source_product_id,null,p.size_code,r.quantity::bigint
    from pos.reference_reclassifications r join pos.products p on p.id=r.source_product_id where v_reclassifications
    union all
    select 'reclassification',r.operation_id,r.target_product_id,null,p.size_code,-r.quantity::bigint
    from pos.reference_reclassifications r join pos.products p on p.id=r.target_product_id where v_reclassifications
  ), resolved as (
    select d.*,p.id product_id,p.record_model,p.size_code,p.stock_quantity,p.stock,
      case
        when d.raw_id is not null and p.id is null then 'missing_product_id'
        when d.raw_id is null and coalesce(sc.n,0)>1 then 'identity_ambiguous'
        when d.raw_id is null and (coalesce(sc.n,0)=0 or coalesce(sc.v1_n,0)<>1) then 'identity_missing'
        when p.record_model='v2' and nullif(trim(coalesce(d.talla,'')),'') is null then 'size_missing'
        when p.record_model='v2' and d.talla<>p.size_code then 'size_mismatch'
        when p.record_model='v1' and (select count(*) from jsonb_array_elements(coalesce(p.stock,'[]'::jsonb)) z where z->>'talla'=d.talla)<>1 then 'size_ambiguous'
        else null end issue
    from doc_lines d left join sku_candidates sc on sc.sku=d.sku
    left join pos.products p on p.id=case when d.raw_id is not null then d.raw_id
      when sc.n=1 and sc.v1_n=1 then sc.product_id else null end
  ), deltas as (
    select product_id,talla,sum(delta)::bigint delta from resolved
    where issue is null group by product_id,talla having sum(delta)<>0
  ), targets as (
    select d.product_id,d.talla,p.record_model,d.delta,
      case when p.record_model='v2' then p.stock_quantity::bigint
        else (select (z->>'stock')::bigint from jsonb_array_elements(p.stock) z where z->>'talla'=d.talla) end current_stock
    from deltas d join pos.products p on p.id=d.product_id
  )
  select coalesce((select jsonb_agg(jsonb_build_object(
      'product_id',t.product_id,'talla',t.talla,'record_model',t.record_model,
      'current_stock',t.current_stock,'delta',t.delta,'target_stock',t.current_stock+t.delta)
      order by t.product_id,t.talla) from targets t),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('origin',r.origin,'ref',r.ref,
      'sku',r.sku,'product_id',r.raw_id,'talla',r.talla,'code',r.issue)
      order by r.origin,r.ref) from resolved r where r.issue is not null),'[]'::jsonb)
  into v_stock,v_issues;

  if v_mode='production' then v_reasons:=v_reasons||jsonb_build_array('cleanup_production_locked'); end if;
  if v_queue<>0 or v_blocked<>0 or v_unsynchronized<>0 then
    v_reasons:=v_reasons||jsonb_build_array('cleanup_not_synchronized');
  end if;
  if v_incompatible<>0 then
    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
      'code','client_schema_incompatible','devices',v_incompatible,
      'minimum_schema',20260817014900));
  end if;
  if v_inventory then v_reasons:=v_reasons||jsonb_build_array('inventory_products_requires_point_zero'); end if;
  if not (v_sales or v_returns or v_exchanges or v_loans or v_commissions or v_reclassifications or v_customers) then
    v_reasons:=v_reasons||jsonb_build_array('cleanup_empty_selection');
  end if;
  if jsonb_array_length(v_issues)>0 then v_reasons:=v_reasons||v_issues; end if;
  -- El saldo se reconstruye desde lo que SOBREVIVE. La evidencia incompleta de
  -- un documento seleccionado para borrado no participa en el saldo final.
  if not v_returns and exists(select 1 from pos.returns r where r.comisiones is null) then
    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('code','commission_evidence_missing','document','return'));
  end if;
  if not v_sales and exists(select 1 from pos.sales s where s.comisiones is null) then
    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('code','commission_evidence_missing','document','sale'));
  end if;
  if not v_sales and exists(select 1 from pos.sales s where s.estado='Cancelado'
      and jsonb_array_length(coalesce(s.comisiones,'[]'::jsonb))>0 and s.comisiones_revertidas is null) then
    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('code','commission_evidence_missing','document','cancelled_sale'));
  end if;
  if not v_commissions and exists(select 1 from pos.commission_adjustments a
      where jsonb_typeof(a.detalle)<>'array' or exists(select 1 from jsonb_array_elements(
        case when jsonb_typeof(a.detalle)='array' then a.detalle else '[]'::jsonb end) j
        where nullif(j->>'seller_id','') is null or nullif(j->>'monto','') is null)) then
    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('code','commission_evidence_missing','document','commission_adjustment'));
  end if;
  if exists(select 1 from jsonb_to_recordset(v_stock) x(target_stock bigint) where x.target_stock<0) then
    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('code','negative_stock'));
  end if;
  if jsonb_array_length(v_documents->'customer_referenced')>0 then
    v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('code','customer_referenced',
      'ids',v_documents->'customer_referenced'));
  end if;

  v_counts:=jsonb_build_object(
    'ventas',jsonb_array_length(v_documents->'sale_folios'),
    'devoluciones',jsonb_array_length(v_documents->'return_ids'),
    'cambios',jsonb_array_length(v_documents->'exchange_ids'),
    'prestamos',jsonb_array_length(v_documents->'loan_ids'),
    'comisiones',jsonb_array_length(v_documents->'liquidation_ids')+jsonb_array_length(v_documents->'commission_adjustment_ids'),
    'reclasificaciones',jsonb_array_length(v_documents->'reclassification_ids'),
    'clientes',jsonb_array_length(v_documents->'customer_ids'));
  v_core:=jsonb_build_object('protocol_version',2,'minimum_client_protocol',2,
    'preset_requested',v_preset,'selection_requested',v_requested,
    'selection_normalized',v_normalized,'forced_dependencies',v_forced,
    'counts',v_counts,'documents',v_documents,'stock',v_stock,
    'blocked_reasons',v_reasons,'data_epoch',v_epoch,'system_mode',v_mode);
  v_hash:=pos.point_zero_sha256(v_core);
  return v_core||jsonb_build_object('ok',true,'plan_hash',v_hash,
    'executable',jsonb_array_length(v_reasons)=0,'queue_pending',v_queue,
    'active_locks',v_blocked,'unsynchronized_devices',v_unsynchronized,
    'incompatible_devices',v_incompatible);
end;
$$;

create or replace function pos.preview_test_data_cleanup(
  p_preset text default 'operations', p_selection jsonb default '{}'::jsonb,
  p_client_protocol integer default 2
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, pos
as $$
declare v_plan jsonb;
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception using errcode='42501',message='cleanup_requires_admin';
  end if;
  v_plan:=pos.test_data_cleanup_plan(p_preset,p_selection);
  if coalesce(p_client_protocol,0)<(v_plan->>'minimum_client_protocol')::integer then
    return jsonb_set(jsonb_set(v_plan,'{executable}','false'::jsonb),'{blocked_reasons}',
      (v_plan->'blocked_reasons')||jsonb_build_array('minimum_client_protocol'));
  end if;
  return v_plan;
end;
$$;

create or replace function pos.test_data_cleanup_payload(p_plan jsonb)
returns jsonb language sql stable security definer
set search_path = pg_catalog, pos
as $$
  select jsonb_build_object(
    'plan',p_plan,
    'products',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from pos.products p
      where p.id in(select s->>'product_id' from jsonb_array_elements(p_plan->'stock') s)),
    'sales',(select coalesce(jsonb_agg(to_jsonb(s) order by s.folio),'[]'::jsonb) from pos.sales s where s.folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))),
    'sale_items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from pos.sale_items i where i.folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))),
    'sale_payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from pos.sale_payments p where p.folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))),
    'physical_card_redemptions',(select coalesce(jsonb_agg(to_jsonb(c) order by c.folio),'[]'::jsonb) from pos.physical_card_redemptions c where c.sale_folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))),
    'sale_commits',(select coalesce(jsonb_agg(to_jsonb(c) order by c.commit_id),'[]'::jsonb) from pos.sale_commits c where c.folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))),
    'stock_reservations',(select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from pos.stock_reservations r where r.folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))),
    'returns',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from pos.returns r where r.id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids'))),
    'return_items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from pos.return_items i where i.return_id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids'))),
    'return_commits',(select coalesce(jsonb_agg(to_jsonb(c) order by c.commit_id),'[]'::jsonb) from pos.return_commits c where c.return_id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids'))),
    'exchanges',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from pos.exchanges e where e.id in(select jsonb_array_elements_text(p_plan->'documents'->'exchange_ids'))),
    'exchange_items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from pos.exchange_items i where i.exchange_id in(select jsonb_array_elements_text(p_plan->'documents'->'exchange_ids'))),
    'exchange_commits',(select coalesce(jsonb_agg(to_jsonb(c) order by c.commit_id),'[]'::jsonb) from pos.exchange_commits c where c.exchange_id in(select jsonb_array_elements_text(p_plan->'documents'->'exchange_ids'))),
    'layaway_liquidation_commits',(select coalesce(jsonb_agg(to_jsonb(c) order by c.commit_id),'[]'::jsonb) from pos.layaway_liquidation_commits c where c.folio in(select jsonb_array_elements_text(p_plan->'documents'->'sale_folios'))),
    'movements',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) from pos.movements m where m.ref in(
      select jsonb_array_elements_text(p_plan->'documents'->'sale_folios') union
      select r.folio from pos.returns r where r.id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids')) union
      select e.folio from pos.exchanges e where e.id in(select jsonb_array_elements_text(p_plan->'documents'->'exchange_ids')))
      or m.return_id in(select jsonb_array_elements_text(p_plan->'documents'->'return_ids'))
      or m.operation_id in(select jsonb_array_elements_text(p_plan->'documents'->'reclassification_ids'))),
    'loans',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'::jsonb) from pos.loan_documents l where l.id in(select jsonb_array_elements_text(p_plan->'documents'->'loan_ids'))),
    'liquidations',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'::jsonb) from pos.liquidations l where l.id in(select jsonb_array_elements_text(p_plan->'documents'->'liquidation_ids'))),
    'commission_adjustments',(select coalesce(jsonb_agg(to_jsonb(a) order by a.operation_id),'[]'::jsonb) from pos.commission_adjustments a where a.operation_id::text in(select jsonb_array_elements_text(p_plan->'documents'->'commission_adjustment_ids'))),
    'reference_reclassifications',(select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from pos.reference_reclassifications r where r.operation_id in(select jsonb_array_elements_text(p_plan->'documents'->'reclassification_ids'))),
    'clients',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from pos.clients c where c.id in(select jsonb_array_elements_text(p_plan->'documents'->'customer_ids'))),
    'sellers',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from pos.sellers s)
  )
$$;

create or replace function pos.create_test_data_cleanup_backup(
  p_preset text,p_selection jsonb,p_plan_hash text,p_client_protocol integer default 2,
  p_client_build text default null,p_device_id text default null
) returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, pos, auth
as $$
declare v_plan jsonb;v_payload jsonb;v_id uuid;v_payload_hash text;v_document jsonb;
begin
  v_plan:=pos.preview_test_data_cleanup(p_preset,p_selection,p_client_protocol);
  if not coalesce((v_plan->>'executable')::boolean,false) then raise exception 'cleanup_plan_not_executable'; end if;
  if v_plan->>'plan_hash'<>coalesce(p_plan_hash,'') then raise exception 'cleanup_preview_changed'; end if;
  v_payload:=pos.test_data_cleanup_payload(v_plan);
  v_payload_hash:=pos.point_zero_sha256(v_payload);
  insert into pos.test_data_cleanup_backups(created_by,actor_email,device_id,client_build,
    protocol_version,data_epoch,preset,selection_normalized,plan_hash,payload_hash,payload)
  values(auth.uid(),auth.jwt()->>'email',p_device_id,p_client_build,p_client_protocol,
    (v_plan->>'data_epoch')::bigint,p_preset,v_plan->'selection_normalized',p_plan_hash,v_payload_hash,v_payload)
  returning backup_id into v_id;
  v_document:=jsonb_build_object('format','balam-selective-cleanup-backup-v2','backup_id',v_id,
    'created_at',statement_timestamp(),'user',auth.jwt()->>'email','protocol_version',p_client_protocol,
    'data_epoch',v_plan->'data_epoch','preset',p_preset,'selection_normalized',v_plan->'selection_normalized',
    'plan_hash',p_plan_hash,'payload_hash',v_payload_hash,'payload',v_payload);
  return jsonb_build_object('ok',true,'backup_id',v_id,'plan_hash',p_plan_hash,
    'payload_hash',v_payload_hash,'document',v_document);
end;
$$;

create or replace function pos.execute_test_data_cleanup(
  p_cleanup_id text,p_preset text,p_selection jsonb,p_plan_hash text,p_backup_id uuid,
  p_confirmation text,p_client_protocol integer default 2,p_client_build text default null,
  p_device_id text default null
) returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, pos, auth
as $$
declare
  v_plan jsonb;v_backup pos.test_data_cleanup_backups%rowtype;
  v_prior pos.test_data_cleanup_operations%rowtype;v_epoch bigint;v_result jsonb;
  v_stock record;v_idx integer;v_now timestamptz:=statement_timestamp();
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception using errcode='42501',message='cleanup_requires_admin';
  end if;
  if nullif(trim(coalesce(p_cleanup_id,'')),'') is null then raise exception 'cleanup_invalid_id'; end if;
  if p_confirmation is distinct from 'LIMPIAR OPERACIONES' then raise exception 'cleanup_confirmation_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pos.execute-test-data-cleanup',0));
  select * into v_prior from pos.test_data_cleanup_operations where cleanup_id=p_cleanup_id;
  if found then return v_prior.result||jsonb_build_object('idempotent',true); end if;
  v_plan:=pos.preview_test_data_cleanup(p_preset,p_selection,p_client_protocol);
  if v_plan->>'system_mode'='production' then raise exception 'cleanup_production_locked'; end if;
  if not coalesce((v_plan->>'executable')::boolean,false) then raise exception 'cleanup_plan_not_executable'; end if;
  if v_plan->>'plan_hash'<>coalesce(p_plan_hash,'') then raise exception 'cleanup_preview_changed'; end if;
  select * into v_backup from pos.test_data_cleanup_backups where backup_id=p_backup_id and created_by=auth.uid();
  if not found or v_backup.plan_hash<>p_plan_hash or v_backup.data_epoch<>(v_plan->>'data_epoch')::bigint
     or v_backup.selection_normalized<>v_plan->'selection_normalized'
     or v_backup.payload_hash<>pos.point_zero_sha256(v_backup.payload) then
    raise exception 'cleanup_backup_mismatch';
  end if;
  insert into pos.test_data_cleanup_operations(cleanup_id,backup_id,status,actor_user_id,
    actor_email,device_id,client_build,protocol_version,data_epoch_before,preset,
    selection_normalized,plan_hash)
  values(p_cleanup_id,p_backup_id,'running',auth.uid(),auth.jwt()->>'email',p_device_id,
    p_client_build,p_client_protocol,(v_plan->>'data_epoch')::bigint,p_preset,
    v_plan->'selection_normalized',p_plan_hash);

  -- Inventario primero, bajo el mismo lock/transacción. Nunca se recorta a cero.
  for v_stock in select * from jsonb_to_recordset(v_plan->'stock') as x(
    product_id text,talla text,record_model text,current_stock bigint,delta bigint,target_stock bigint)
  loop
    if v_stock.target_stock<0 then raise exception 'negative_stock'; end if;
    if v_stock.record_model='v2' then
      update pos.products set stock_quantity=v_stock.target_stock::integer,
        sync_base_version=null,sync_device_id='cleanup:'||p_cleanup_id
      where id=v_stock.product_id and record_model='v2' and stock_quantity=v_stock.current_stock;
      if not found then raise exception 'cleanup_preview_changed'; end if;
    else
      select (z.ordinality-1)::integer into strict v_idx from pos.products p
        cross join lateral jsonb_array_elements(p.stock) with ordinality z(value,ordinality)
        where p.id=v_stock.product_id and p.record_model='v1'
          and z.value->>'talla'=v_stock.talla and (z.value->>'stock')::bigint=v_stock.current_stock;
      update pos.products set stock=jsonb_set(stock,array[v_idx::text,'stock'],to_jsonb(v_stock.target_stock),false),
        sync_base_version=null,sync_device_id='cleanup:'||p_cleanup_id where id=v_stock.product_id;
      if not found then raise exception 'cleanup_preview_changed'; end if;
    end if;
  end loop;

  insert into pos.purged_documents(kind,identity,purge_id)
    select 'sale',x,p_cleanup_id from jsonb_array_elements_text(v_plan->'documents'->'sale_operation_ids') x
    on conflict(kind,identity) do nothing;
  insert into pos.purged_documents(kind,identity,purge_id)
    select 'return',x,p_cleanup_id from jsonb_array_elements_text(v_plan->'documents'->'return_ids') x
    on conflict(kind,identity) do nothing;
  insert into pos.purged_documents(kind,identity,purge_id)
    select 'exchange',x,p_cleanup_id from jsonb_array_elements_text(v_plan->'documents'->'exchange_ids') x
    on conflict(kind,identity) do nothing;
  insert into pos.purged_documents(kind,identity,purge_id)
    select 'loan',x,p_cleanup_id from jsonb_array_elements_text(v_plan->'documents'->'loan_ids') x
    on conflict(kind,identity) do nothing;

  -- Hijos, evidencias transaccionales y kardex se eliminan sólo por identidad.
  delete from pos.physical_card_redemptions c where c.sale_folio in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  delete from pos.return_commits c where c.return_id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'));
  delete from pos.exchange_commits c where c.exchange_id in(select jsonb_array_elements_text(v_plan->'documents'->'exchange_ids'));
  delete from pos.layaway_liquidation_commits c where c.folio in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  delete from pos.sale_commits c where c.folio in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  delete from pos.stock_reservations r where r.folio in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  delete from pos.movements m where m.ref in(
    select jsonb_array_elements_text(v_plan->'documents'->'sale_folios') union
    select r.folio from pos.returns r where r.id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids')) union
    select e.folio from pos.exchanges e where e.id in(select jsonb_array_elements_text(v_plan->'documents'->'exchange_ids')))
    or m.return_id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'))
    or m.operation_id in(select jsonb_array_elements_text(v_plan->'documents'->'reclassification_ids'));
  delete from pos.sale_payments p where p.folio in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  delete from pos.return_items i where i.return_id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'));
  delete from pos.exchange_items i where i.exchange_id in(select jsonb_array_elements_text(v_plan->'documents'->'exchange_ids'));
  delete from pos.sale_items i where i.folio in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  delete from pos.returns r where r.id in(select jsonb_array_elements_text(v_plan->'documents'->'return_ids'));
  delete from pos.exchanges e where e.id in(select jsonb_array_elements_text(v_plan->'documents'->'exchange_ids'));
  delete from pos.sales s where s.folio in(select jsonb_array_elements_text(v_plan->'documents'->'sale_folios'));
  delete from pos.loan_documents l where l.id in(select jsonb_array_elements_text(v_plan->'documents'->'loan_ids'));
  delete from pos.liquidations l where l.id in(select jsonb_array_elements_text(v_plan->'documents'->'liquidation_ids'));
  delete from pos.commission_adjustments a where a.operation_id::text in(select jsonb_array_elements_text(v_plan->'documents'->'commission_adjustment_ids'));
  update pos.reference_reclassifications set reversed_by=null,reversal_of=null
    where operation_id in(select jsonb_array_elements_text(v_plan->'documents'->'reclassification_ids'));
  delete from pos.reference_reclassifications r where r.operation_id in(select jsonb_array_elements_text(v_plan->'documents'->'reclassification_ids'));
  update pos.clients c set deleted_at=v_now,sync_base_version=null,sync_device_id='cleanup:'||p_cleanup_id
    where c.id in(select jsonb_array_elements_text(v_plan->'documents'->'customer_ids'));

  -- Autoridad H-69: saldo derivado de documentos CONGELADOS conservados.
  with generated as (
    select j->>'sellerId' seller_id,sum(coalesce((j->>'monto')::numeric,0)) amount
      from pos.sales s cross join lateral jsonb_array_elements(coalesce(s.comisiones,'[]'::jsonb)) j group by j->>'sellerId'
    union all select e.vendedor_id,sum(case when e.comision_revertida is null then coalesce(e.comision_monto,0) else 0 end) from pos.exchanges e group by e.vendedor_id
    union all select j->>'sellerId',-sum(coalesce((j->>'monto')::numeric,0)) from pos.returns r cross join lateral jsonb_array_elements(coalesce(r.comisiones,'[]'::jsonb)) j group by j->>'sellerId'
    union all select j->>'sellerId',-sum(coalesce((j->>'monto')::numeric,0)) from pos.sales s cross join lateral jsonb_array_elements(coalesce(s.comisiones_revertidas,'[]'::jsonb)) j where s.estado='Cancelado' group by j->>'sellerId'
    union all select j->>'seller_id',sum(coalesce((j->>'monto')::numeric,0)) from pos.commission_adjustments a cross join lateral jsonb_array_elements(a.detalle) j group by j->>'seller_id'
    union all select l.seller_id,-sum(l.monto) from pos.liquidations l where coalesce(l.tipo,'liquidacion')<>'ajuste' group by l.seller_id
  ), totals as (select seller_id,sum(amount) amount from generated where seller_id is not null group by seller_id)
  update pos.sellers s set comision_acum=coalesce(t.amount,0),sync_base_version=null,
    sync_device_id='cleanup:'||p_cleanup_id from (select s2.id,coalesce(t2.amount,0) amount
      from pos.sellers s2 left join totals t2 on t2.seller_id=s2.id) t where s.id=t.id;

  with sale_volume as (
    select seller_id,sum(total/parts)::numeric amount,count(*)::integer documents from (
      select jsonb_array_elements_text(s.vendedores) seller_id,s.total,
        case when jsonb_array_length(s.vendedores)>0 then jsonb_array_length(s.vendedores) else 1 end parts
      from pos.sales s where s.estado<>'Cancelado' and jsonb_typeof(s.vendedores)='array') x
    group by seller_id)
  update pos.sellers s set ventas_mes=coalesce(v.amount,0),ventas_num=coalesce(v.documents,0),
    sync_base_version=null,sync_device_id='cleanup:'||p_cleanup_id
    from (select s2.id,coalesce(x.amount,0) amount,coalesce(x.documents,0) documents
      from pos.sellers s2 left join sale_volume x on x.seller_id=s2.id) v where s.id=v.id;

  update pos.system_manifest set data_epoch=data_epoch+1,
    schema_version=case when schema_version<20260817014900 then 20260817014900 else schema_version end,
    updated_at=now() where singleton returning data_epoch into v_epoch;
  -- Cliente anterior al protocolo 2 falla cerrado y debe rebootstrap, nunca purga total.
  update pos.sync_devices set status='must_rebootstrap' where device_id is not null;
  perform pos.bump_sync_domain('products','selective-cleanup:'||p_cleanup_id);
  perform pos.bump_sync_domain('clients','selective-cleanup:'||p_cleanup_id);
  perform pos.bump_sync_domain('sellers','selective-cleanup:'||p_cleanup_id);
  perform pos.bump_sync_domain('sales','selective-cleanup:'||p_cleanup_id);
  perform pos.bump_sync_domain('movements','selective-cleanup:'||p_cleanup_id);

  v_result:=jsonb_build_object('ok',true,'status','completed','cleanup_id',p_cleanup_id,
    'backup_id',p_backup_id,'protocol_version',2,'minimum_client_protocol',2,
    'preset',p_preset,'selection_normalized',v_plan->'selection_normalized',
    'forced_dependencies',v_plan->'forced_dependencies','plan_hash',p_plan_hash,
    'data_epoch',v_epoch,'purged_at',v_now,'counts',v_plan->'counts',
    'identities',v_plan->'documents','stock',v_plan->'stock');
  insert into pos.selective_cleanup_events(cleanup_id,protocol_version,minimum_client_protocol,
    preset,selection_normalized,plan_hash,data_epoch,purged_at,identities)
  values(p_cleanup_id,2,2,p_preset,v_plan->'selection_normalized',p_plan_hash,v_epoch,v_now,v_plan->'documents');
  -- `test_data_purges` se conserva como auditoría H-68, pero NO recibe este
  -- evento: un cliente antiguo lo leería como purga total. La evidencia de esta
  -- operación vive en selective_cleanup_events y en las dos tablas de auditoría.
  update pos.test_data_cleanup_operations set status='completed',completed_at=now(),
    data_epoch_after=v_epoch,result=v_result where cleanup_id=p_cleanup_id;
  return v_result;
end;
$$;

create or replace function pos.test_data_cleanup_receipt(p_cleanup_id text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pos as $$
declare v_row pos.test_data_cleanup_operations%rowtype;
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception using errcode='42501',message='cleanup_requires_admin';
  end if;
  select * into strict v_row from pos.test_data_cleanup_operations where cleanup_id=p_cleanup_id;
  return jsonb_build_object('format','balam-selective-cleanup-receipt-v2','cleanup_id',v_row.cleanup_id,
    'backup_id',v_row.backup_id,'status',v_row.status,'started_at',v_row.started_at,
    'completed_at',v_row.completed_at,'plan_hash',v_row.plan_hash,'result',v_row.result);
end;
$$;

revoke all on function pos.test_data_cleanup_plan(text,jsonb),
  pos.test_data_cleanup_payload(jsonb) from public,anon,authenticated;
revoke all on function pos.preview_test_data_cleanup(text,jsonb,integer),
  pos.create_test_data_cleanup_backup(text,jsonb,text,integer,text,text),
  pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text),
  pos.test_data_cleanup_receipt(text) from public,anon;
grant execute on function pos.preview_test_data_cleanup(text,jsonb,integer),
  pos.create_test_data_cleanup_backup(text,jsonb,text,integer,text,text),
  pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text),
  pos.test_data_cleanup_receipt(text) to authenticated;

update pos.system_manifest set schema_version=case when schema_version<20260817014900
  then 20260817014900 else schema_version end,updated_at=now() where singleton;

commit;

-- H-94: CONFIG objetivo para referencias físicas V2.
-- Despliegue de datos, no de inventario: aplica únicamente _catalogMeta y
-- ornament.meta dentro de una transacción con huella V1 antes/después.
begin;

do $$
declare
  v_operation_id constant text := 'h94-config-target-20260811-v1';
  v_meta jsonb;
  v_product_hash_before text;
  v_product_hash_after text;
  v_documents_hash_before text;
  v_documents_hash_after text;
  v_products bigint;
  v_v1 bigint;
  v_v2 bigint;
  v_lookup bigint;
  v_characteristics bigint;
  v_characteristics_active bigint;
  v_version bigint;
  v_payload_hash text;
  v_ornament_colors jsonb;
  r record;
begin
  if exists(select 1 from pos.config_commits where operation_id=v_operation_id) then
    raise notice 'H94_CONFIG_TARGET already applied';
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pos.config',0));
  select version into v_version from pos.config_sync_state where singleton for update;
  if v_version is null then raise exception 'h94_config_state_missing'; end if;

  select count(*),
         count(*) filter(where coalesce(record_model,'v1')='v1'),
         count(*) filter(where record_model='v2')
    into v_products,v_v1,v_v2 from pos.products;
  if v_products <> 1378 or v_v1 <> 1378 or v_v2 <> 0 then
    raise exception 'h94_product_guard_failed total=% v1=% v2=%',v_products,v_v1,v_v2;
  end if;
  if (select count(*) from pos.sales) <> 1
     or (select count(*) from pos.movements) <> 1
     or (select count(*) from pos.returns) <> 0
     or (select count(*) from pos.exchanges) <> 0
     or (select count(*) from pos.loan_documents) <> 0
     or (select count(*) from pos.reference_reclassifications) <> 0 then
    raise exception 'h94_document_guard_failed';
  end if;

  select count(*) into v_lookup from pos.lookup;
  select count(*),count(*) filter(where active)
    into v_characteristics,v_characteristics_active
    from pos.lookup where kind='caracteristicas';
  if v_characteristics <> 69 or v_characteristics_active <> 69
     or exists(
       select 1 from generate_series(1,69) n
       where not exists(select 1 from pos.lookup where kind='caracteristicas' and code=n::text)
     ) then
    raise exception 'h94_characteristics_guard_failed total=% active=%',
      v_characteristics,v_characteristics_active;
  end if;

  select value into v_meta from pos.settings where key='_catalogMeta' for update;
  if v_meta is null or not (v_meta ?& array[
    'category','producto','sleeve','fabric','color','neck','ornament',
    'size_letter','size_number','corte','caracteristicas'
  ]) or v_meta ? 'ornament_color' then
    raise exception 'h94_catalog_meta_guard_failed keys=%',coalesce((
      select array_agg(key order by key) from jsonb_object_keys(coalesce(v_meta,'{}'::jsonb)) key
    ),array[]::text[]);
  end if;
  -- La autoridad remota debe nacer aquí. Cualquier fila previa exige una
  -- auditoría separada: esta migración no mezcla, completa ni sobrescribe.
  if exists(select 1 from pos.lookup where kind='ornament_color') then
    raise exception 'h94_ornament_color_must_be_absent rows=%',
      (select count(*) from pos.lookup where kind='ornament_color');
  end if;
  -- Estado publicado auditado el 11/08/2026. Una edición posterior no se pisa.
  if coalesce((v_meta#>>'{producto,inForm}')::boolean,false)
     or coalesce((v_meta#>>'{producto,inReference}')::boolean,false)
     or not coalesce((v_meta#>>'{producto,inSku}')::boolean,false)
     or coalesce((v_meta#>>'{fabric,inSku}')::boolean,false)
     or coalesce((v_meta#>>'{neck,inSku}')::boolean,false)
     or coalesce((v_meta#>>'{ornament,inForm}')::boolean,false)
     or coalesce((v_meta#>>'{ornament,inSku}')::boolean,false)
     or coalesce((v_meta#>>'{ornament_color,inSku}')::boolean,false)
     or coalesce((v_meta#>>'{corte,inReference}')::boolean,false)
     or coalesce((v_meta#>>'{caracteristicas,inReference}')::boolean,false)
     or v_meta ? 'effective_size' then
    raise exception 'h94_published_config_changed';
  end if;

  select md5(coalesce(string_agg(to_jsonb(p)::text,E'\n' order by p.id::text),''))
    into v_product_hash_before from pos.products p;
  select md5(
    coalesce((select string_agg(to_jsonb(s)::text,E'\n' order by s.folio) from pos.sales s),'') || E'\n' ||
    coalesce((select string_agg(to_jsonb(m)::text,E'\n' order by m.id::text) from pos.movements m),'') || E'\n' ||
    coalesce((select string_agg(to_jsonb(x)::text,E'\n' order by x.id::text) from pos.returns x),'') || E'\n' ||
    coalesce((select string_agg(to_jsonb(x)::text,E'\n' order by x.id::text) from pos.exchanges x),'')
  ) into v_documents_hash_before;

  insert into pos.lookup(kind,code,label,active,sort_order,meta,updated_at)
  values
    ('ornament_color','DRO','Dorado',true,0,'{}'::jsonb,now()),
    ('ornament_color','AZL','Azul',true,1,'{}'::jsonb,now()),
    ('ornament_color','CF','Café',true,2,'{}'::jsonb,now()),
    ('ornament_color','PLT','Plateado',true,3,'{}'::jsonb,now()),
    ('ornament_color','BL','Blanco',true,4,'{}'::jsonb,now()),
    ('ornament_color','NE','Negro',true,5,'{}'::jsonb,now());

  select jsonb_agg(jsonb_build_object(
           'kind',kind,'code',code,'label',label,'active',active,'sort_order',sort_order
         ) order by sort_order)
    into v_ornament_colors
    from pos.lookup where kind='ornament_color';
  if v_ornament_colors <> jsonb_build_array(
       jsonb_build_object('kind','ornament_color','code','DRO','label','Dorado','active',true,'sort_order',0),
       jsonb_build_object('kind','ornament_color','code','AZL','label','Azul','active',true,'sort_order',1),
       jsonb_build_object('kind','ornament_color','code','CF','label','Café','active',true,'sort_order',2),
       jsonb_build_object('kind','ornament_color','code','PLT','label','Plateado','active',true,'sort_order',3),
       jsonb_build_object('kind','ornament_color','code','BL','label','Blanco','active',true,'sort_order',4),
       jsonb_build_object('kind','ornament_color','code','NE','label','Negro','active',true,'sort_order',5)
     ) then
    raise exception 'h94_ornament_color_exact_set_failed rows=%',v_ornament_colors;
  end if;

  v_meta := jsonb_set(v_meta,'{ornament_color}',jsonb_build_object(
    'label','Color de ornamento','field','ornamentColorCodes','system',true,
    'formSelect',true,'multiselect',true
  ),true);

  for r in
    select * from (values
      ('category',true,true,true,true,false,1),
      ('producto',true,true,true,true,false,2),
      ('sleeve',true,true,true,true,false,3),
      ('fabric',true,true,true,true,true,4),
      ('color',true,true,true,true,true,5),
      ('neck',true,true,true,true,false,6),
      ('ornament',true,true,true,true,false,7),
      ('ornament_color',true,true,true,false,true,8),
      ('size_letter',false,true,false,true,false,9),
      ('size_number',false,true,false,true,false,9),
      ('corte',true,true,false,false,false,10),
      ('caracteristicas',true,true,false,false,true,11)
    ) as target(kind,in_form,in_reference,in_sku,required,filterable,sku_order)
  loop
    v_meta := jsonb_set(v_meta,array[r.kind],
      (coalesce(v_meta->r.kind,'{}'::jsonb) - 'sizeSlot' - 'effectiveSize' - 'virtual') || jsonb_build_object(
        'inForm',r.in_form,'inReference',r.in_reference,'inSku',r.in_sku,
        'required',r.required,'filterable',r.filterable,'skuOrder',r.sku_order
      ),true);
  end loop;
  v_meta := jsonb_set(v_meta,'{effective_size}',jsonb_build_object(
    'label','Talla efectiva','inForm',false,'inReference',true,'inSku',true,
    'required',true,'filterable',false,'skuOrder',9,'system',true,
    'struct',true,'virtual',true,'sizeSlot',true,'effectiveSize',true
  ),true);

  update pos.settings set value=v_meta,updated_at=now() where key='_catalogMeta';
  if not found then raise exception 'h94_catalog_meta_update_missing'; end if;

  update pos.lookup
     set meta=coalesce(meta,'{}'::jsonb) || jsonb_build_object('colorMode',
       case
         when code in ('—','NA') or meta->>'allowsColors'='false' then 'none'
         when meta->>'colorMode' in ('none','optional','required') then meta->>'colorMode'
         else 'optional'
       end),
       updated_at=now()
   where kind='ornament';

  if (select count(*) from pos.lookup) <> v_lookup + 6
     or (select count(*) from pos.lookup where kind='caracteristicas') <> 69 then
    raise exception 'h94_lookup_cardinality_changed';
  end if;

  select md5(coalesce(string_agg(to_jsonb(p)::text,E'\n' order by p.id::text),''))
    into v_product_hash_after from pos.products p;
  select md5(
    coalesce((select string_agg(to_jsonb(s)::text,E'\n' order by s.folio) from pos.sales s),'') || E'\n' ||
    coalesce((select string_agg(to_jsonb(m)::text,E'\n' order by m.id::text) from pos.movements m),'') || E'\n' ||
    coalesce((select string_agg(to_jsonb(x)::text,E'\n' order by x.id::text) from pos.returns x),'') || E'\n' ||
    coalesce((select string_agg(to_jsonb(x)::text,E'\n' order by x.id::text) from pos.exchanges x),'')
  ) into v_documents_hash_after;
  if v_product_hash_before <> v_product_hash_after
     or v_documents_hash_before <> v_documents_hash_after then
    raise exception 'h94_protected_data_changed';
  end if;

  update pos.config_sync_state set version=version+1,updated_at=now()
    where singleton returning version into v_version;
  v_payload_hash := md5(v_meta::text || E'\n' || coalesce((
    select string_agg(jsonb_build_object('code',code,'meta',meta)::text,E'\n' order by code)
    from pos.lookup where kind in ('ornament','ornament_color')
  ),''));
  insert into pos.config_commits(operation_id,payload_hash,committed_version,device_id)
  values(v_operation_id,v_payload_hash,v_version,'deployment-h94-config');

  raise notice 'H94_CONFIG_TARGET_OK products=% v1=% v2=% product_hash=% documents_hash=% config_version=% colors=% meta=%',
    v_products,v_v1,v_v2,v_product_hash_after,v_documents_hash_after,v_version,
    v_ornament_colors,v_meta->'ornament_color';
end;
$$;

commit;

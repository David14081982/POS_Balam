-- H-155: exercise the actual guard on temporary rows, never business products.
begin;
do $h155_verify$
declare
  v_id text := '15500000-0000-4000-8000-000000000001';
  v_before jsonb; v_after jsonb; v_case jsonb; v_rejected boolean;
begin
  if pos.h133_internal_enabled() then raise exception 'H155_VERIFICATION_INTERNAL_BYPASS'; end if;
  create temporary table h155_ornament_probe(like pos.products including defaults) on commit drop;
  insert into h155_ornament_probe(id,cat,manga,tela,color,cuello,modelo,nombre,orn,
    record_model,size_category_id,size_code,size_scale,stock_quantity,barcode_code,
    barcode_contract,barcode_aliases,reference_family_id,physical_signature,
    physical_identity_locked,ornament_color_codes,attrs,precio,costo,stock)
  values(v_id,'1','ML','ALG','BL','NOR','H155','H155 TEMPORAL','BEL',
    'v2','size_number','38','N',2,pos.h133_barcode_v3_from_id(v_id),3,'[]',
    '15500000-0000-4000-8000-000000000010','H155 IMMUTABLE',true,
    '["VNO","DRO"]','{"__sizeCategoryId":"size_number","corte":"REG"}',100,50,'[]');
  create trigger h155_actual_identity_guard before update on h155_ornament_probe
    for each row execute function pos.h94_guard_used_reference_identity();
  select to_jsonb(p) into v_before from h155_ornament_probe p where id=v_id;
  update h155_ornament_probe set precio=101,ornament_color_codes='["DRO","VNO"]' where id=v_id;
  select to_jsonb(p) into v_after from h155_ornament_probe p where id=v_id;
  if v_after->'ornament_color_codes' <> '["DRO","VNO"]'::jsonb
     or (v_after->>'precio')::numeric <> 101
     or (v_after-'precio'-'ornament_color_codes') is distinct from (v_before-'precio'-'ornament_color_codes') then
    raise exception 'H155_PERMUTATION_OR_NEW_NOT_PRESERVED';
  end if;
  v_before := v_after;
  -- The set and the multiplicity are both protected. Types are never coerced.
  for v_case in select value from jsonb_array_elements(
    '[["DRO"],["DRO","VNO","AZ"],["DRO","AZ"],["DRO","VNO","DRO"],
      ["DRO",1],["DRO",null],{"DRO":true},"DRO",null,[]]'::jsonb) loop
    v_rejected := false;
    begin
      update h155_ornament_probe set ornament_color_codes=v_case,precio=999 where id=v_id;
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'REFERENCE_RECLASSIFICATION_REQUIRED' then raise; end if;
      v_rejected := true;
    end;
    select to_jsonb(p) into v_after from h155_ornament_probe p where id=v_id;
    if not v_rejected or v_after is distinct from v_before then
      raise exception 'H155_COLOR_CHANGE_OR_PARTIAL_EFFECT: %',v_case;
    end if;
  end loop;
  v_rejected := false;
  begin
    update h155_ornament_probe set ornament_color_codes=null where id=v_id;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'REFERENCE_RECLASSIFICATION_REQUIRED' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'H155_SQL_NULL_ACCEPTED'; end if;
  -- A valid permutation must not conceal a change in any other protected field.
  for v_case in select value from jsonb_array_elements('[
    {"physical_signature":"OTHER"},{"cat":"2"},{"manga":"MC"},
    {"tela":"POL"},{"color":"NEG"},{"cuello":"MAO"},{"modelo":"OTHER"},
    {"orn":"OTHER"},{"size_category_id":"size_letter"},{"size_code":"40"},
    {"size_scale":"L"},{"attrs":{"__sizeCategoryId":"size_number","corte":"OTHER"}}
  ]'::jsonb) loop
    v_rejected := false;
    begin
      execute format('update h155_ornament_probe set %I=(jsonb_populate_record(null::h155_ornament_probe,$1)).%I,
        ornament_color_codes=''["VNO","DRO"]'',precio=999 where id=$2',
        (select jsonb_object_keys(v_case)),(select jsonb_object_keys(v_case))) using v_case,v_id;
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'REFERENCE_RECLASSIFICATION_REQUIRED' then raise; end if;
      v_rejected := true;
    end;
    select to_jsonb(p) into v_after from h155_ornament_probe p where id=v_id;
    if not v_rejected or v_after is distinct from v_before then
      raise exception 'H155_OTHER_IDENTITY_CHANGE_OR_PARTIAL_EFFECT: %',v_case;
    end if;
  end loop;
  v_rejected := false;
  begin
    update h155_ornament_probe set barcode_code='OTHER' where id=v_id;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BARCODE_IMMUTABLE' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'H155_BARCODE_GUARD_LOST'; end if;
  v_rejected := false;
  begin
    update h155_ornament_probe set record_model='v1' where id=v_id;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'REFERENCE_MODEL_IMMUTABLE' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'H155_MODEL_GUARD_LOST'; end if;
end;
$h155_verify$;
commit;

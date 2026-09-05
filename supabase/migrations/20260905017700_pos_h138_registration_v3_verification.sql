-- Sin productos comerciales: la guarda real se ejerce sobre una tabla temporal.
begin;
do $h138_verify$
declare v_definition text; v_denied boolean; v_id text := '13800000-0000-4000-8000-000000000099';
begin
  select pg_get_functiondef('pos.save_products_checked(uuid,jsonb)'::regprocedure) into v_definition;
  if position('x.physical_signature,x.reference_family_id,x.barcode_contract' in v_definition)=0
     or position('require_current_capability' in v_definition)=0 then raise exception 'H138_SINGLE_CONTRACT'; end if;
  select pg_get_functiondef('pos.commit_reference_family_batch_h101_internal(uuid,uuid,jsonb,integer,bigint)'::regprocedure) into v_definition;
  if position('x.physical_signature,x.reference_family_id,x.barcode_contract' in v_definition)=0
     or position('assert_sync_write_context' in v_definition)=0
     or position('require_current_capability' in v_definition)=0 then raise exception 'H138_FAMILY_CONTRACT'; end if;
  -- La forma de inserción se comprueba funcionalmente en test-h138-registration-sql.mjs.
  create temporary table h138_registration_probe(like pos.products including defaults) on commit drop;
  alter table h138_registration_probe
    alter column cat set default '1', alter column manga set default 'ML',
    alter column tela set default 'POL', alter column color set default 'AMAR',
    alter column modelo set default 'PRE', alter column nombre set default 'H138 TEMPORAL';
  create trigger h138_real_guard before insert on h138_registration_probe
    for each row execute function pos.h133_guard_operational_inventory();
  if exists(select 1 from pos.inventory_contract_state where singleton and enforced) then
    insert into h138_registration_probe(id,record_model,barcode_code,barcode_contract,barcode_aliases)
      values(v_id,'v2',pos.h133_barcode_v3_from_id(v_id),3,'[]');
    v_denied := false;
    begin
      insert into h138_registration_probe(id,record_model,barcode_code,barcode_contract,barcode_aliases)
        values(v_id,'v2',pos.h133_barcode_v3_from_id(v_id),null,'[]');
    exception when others then
      if sqlerrm<>'BARCODE_CONTRACT_V3_REQUIRED' then raise; end if;
      v_denied := true;
    end;
    if not v_denied then raise exception 'H138_NULL_CONTRACT_ACCEPTED'; end if;
    v_denied := false;
    begin
      insert into h138_registration_probe(id,record_model,barcode_code,barcode_contract,barcode_aliases)
        values(v_id,'v2','39999999999999999999999999',3,'[]');
    exception when others then
      if sqlerrm<>'BARCODE_CONTRACT_V3_REQUIRED' then raise; end if;
      v_denied := true;
    end;
    if not v_denied then raise exception 'H138_WRONG_BARCODE_ACCEPTED'; end if;
    if (select count(*) from h138_registration_probe)<>1 then raise exception 'H138_PROBE_NOT_ATOMIC'; end if;
  end if;
end;
$h138_verify$;
commit;

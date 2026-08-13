-- H-98: verificacion autocontenida y NO destructiva (ADR-004).
-- La instalacion real contiene datos de prueba del negocio: esta migracion no
-- ejecuta Punto Cero sobre ellos. Verifica fronteras, permisos, modo, plan y la
-- semantica de rollback con fixtures temporales; el recorrido exitoso completo
-- pertenece al arnes sintetico y se detiene antes del borrado autorizado.
begin;

do $$
declare v_def text; v_count integer; v_before text; v_after text;
begin
  if to_regclass('pos.point_zero_backups') is null
     or to_regclass('pos.point_zero_operations') is null then
    raise exception 'H98_MISSING_AUDIT_TABLES';
  end if;
  if to_regprocedure('pos.point_zero_preview()') is null
     or to_regprocedure('pos.create_point_zero_backup(text,text,text)') is null
     or to_regprocedure('pos.execute_point_zero(text,text,uuid,text,text,text)') is null
     or to_regprocedure('pos.point_zero_receipt(text)') is null then
    raise exception 'H98_MISSING_RPC';
  end if;
  if has_function_privilege('anon','pos.point_zero_preview()','execute')
     or has_function_privilege('anon','pos.execute_point_zero(text,text,uuid,text,text,text)','execute') then
    raise exception 'H98_ANON_CAN_EXECUTE';
  end if;
  if not has_function_privilege('authenticated','pos.point_zero_preview()','execute')
     or not has_function_privilege('authenticated','pos.execute_point_zero(text,text,uuid,text,text,text)','execute') then
    raise exception 'H98_AUTHENTICATED_MISSING_RPC';
  end if;
  if has_table_privilege('authenticated','pos.point_zero_backups','insert')
     or has_table_privilege('authenticated','pos.point_zero_operations','insert') then
    raise exception 'H98_CLIENT_CAN_BYPASS_RPC';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='pos'
      and table_name='system_manifest' and column_name='system_mode') then
    raise exception 'H98_MISSING_SYSTEM_MODE';
  end if;

  v_def := pg_get_functiondef('pos.execute_point_zero(text,text,uuid,text,text,text)'::regprocedure);
  if position('point_zero_production_locked' in v_def)=0
     or position('point_zero_preview_changed' in v_def)=0
     or position('point_zero_backup_mismatch' in v_def)=0
     or position('point_zero_confirmation_required' in v_def)=0
     or position('pg_advisory_xact_lock' in v_def)=0
     or position('purge_test_data' in v_def)=0
     or position('delete from pos.products' in lower(v_def))=0
     or position('delete from pos.reference_reclassifications' in lower(v_def))=0
     or position('exception when others' in lower(v_def))=0 then
    raise exception 'H98_EXECUTION_CONTRACT_INCOMPLETE';
  end if;
  if v_def ~* 'delete[[:space:]]+from[[:space:]]+pos\.(settings|lookup|sellers|permission_roles)' then
    raise exception 'H98_PRESERVED_TABLE_IN_DELETE_PLAN';
  end if;
  v_count := (select count(*) from regexp_matches(lower(v_def),'delete from pos\.[a-z_]+[^;]*where','g'));
  if v_count < 4 then raise exception 'H98_UNGUARDED_DELETE_PLAN'; end if;

  -- Fixture temporal: demuestra que el bloque de excepcion revierte TODO lo
  -- destructivo antes de registrar un fallo. Nunca lee ni modifica tablas pos.
  create temporary table h98_fixture(id integer primary key, value text) on commit drop;
  insert into h98_fixture values(1,'preservar'),(2,'preservar');
  select md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by id),'')) into v_before from h98_fixture x;
  begin
    delete from h98_fixture where id=any(array[1,2]);
    raise exception 'H98_INJECTED_FAILURE';
  exception when others then
    if sqlerrm<>'H98_INJECTED_FAILURE' then raise; end if;
  end;
  select md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by id),'')) into v_after from h98_fixture x;
  if v_after<>v_before or (select count(*) from h98_fixture)<>2 then
    raise exception 'H98_ROLLBACK_INCOMPLETE';
  end if;

  if (select system_mode from pos.system_manifest where singleton) not in ('preproduction','production') then
    raise exception 'H98_INVALID_SYSTEM_MODE';
  end if;
  raise notice 'H98 structure=ok permissions=ok plan=ok ROLLBACK=ok production=guarded';
end;
$$;

commit;

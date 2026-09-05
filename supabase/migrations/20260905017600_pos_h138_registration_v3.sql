-- H-138: completar las altas V3 sin modificar filas ni identidades existentes.
begin;
do $h138$
declare
  v_oid regprocedure; v_before text; v_after text; v_from text[]; v_to text[]; i integer;
begin
  foreach v_oid in array array[
    'pos.save_products_checked(uuid,jsonb)'::regprocedure,
    'pos.commit_reference_family_batch_h101_internal(uuid,uuid,jsonb,integer,bigint)'::regprocedure
  ] loop
    v_before := pg_get_functiondef(v_oid);
    if v_oid='pos.save_products_checked(uuid,jsonb)'::regprocedure then
      v_from := array[
        E'ornament_color_codes,physical_signature\n  )',
        E'x.physical_signature\n  from jsonb_to_recordset',
        E'ornament_color_codes jsonb,physical_signature text\n  )'
      ];
      v_to := array[
        E'ornament_color_codes,physical_signature,reference_family_id,barcode_contract\n  )',
        E'x.physical_signature,x.reference_family_id,x.barcode_contract\n  from jsonb_to_recordset',
        E'ornament_color_codes jsonb,physical_signature text,reference_family_id uuid,barcode_contract smallint\n  )'
      ];
    else
      v_from := array[
        E'ornament_color_codes,physical_signature,reference_family_id\n  )',
        E'x.physical_signature,x.reference_family_id\n  from jsonb_to_recordset',
        E'reference_family_id uuid\n  )'
      ];
      v_to := array[
        E'ornament_color_codes,physical_signature,reference_family_id,barcode_contract\n  )',
        E'x.physical_signature,x.reference_family_id,x.barcode_contract\n  from jsonb_to_recordset',
        E'reference_family_id uuid,barcode_contract smallint\n  )'
      ];
    end if;
    v_after := v_before;
    for i in 1..array_length(v_from,1) loop
      if (length(v_after)-length(replace(v_after,v_from[i],'')))/length(v_from[i])<>1 then
        raise exception 'H138_SOURCE_DRIFT: % fragment %',v_oid,i;
      end if;
      v_after := replace(v_after,v_from[i],v_to[i]);
    end loop;
    -- CREATE OR REPLACE conserva firma, propietario y ACL. Los bloques de
    -- permisos, versiones, idempotencia y edición no se modifican.
    execute v_after;
  end loop;

  v_oid := 'pos.h133_guard_operational_inventory()'::regprocedure;
  v_before := pg_get_functiondef(v_oid);
  if (length(v_before)-length(replace(v_before,'new.barcode_contract<>3','')))/length('new.barcode_contract<>3')<>1 then
    raise exception 'H138_GUARD_SOURCE_DRIFT';
  end if;
  execute replace(v_before,'new.barcode_contract<>3','new.barcode_contract is distinct from 3');
end;
$h138$;
commit;

-- H-175: 35 referencias V2 TIRA BORDADA guardan `modelo = '0TB'` mientras su
-- catálogo Modelo (`attrs.producto`) es 'TB'. El dueño autoriza unificarlas en
-- 'TB'. Sólo cambia `modelo`; id, barcode_code, SKU, stock, precio, attrs y
-- firma física se comparan por hash antes y después. Cualquier diferencia,
-- conjunto inesperado o fila ausente aborta la transacción completa.
-- En una base sin estas filas (entornos nuevos o de prueba) no hace nada.
begin;
do $h175$
declare
  v_ids text[] := array[
    '46bf73ad-9c1c-4497-a4a5-cdcb6f1b0926',
    '6ad47b9a-ae62-4f0c-9a24-67ddb547cf8d',
    'f6b22bc6-f0cf-4959-953a-dab2fb85719a',
    '7541fa15-987a-43d9-8b5a-98b1bd32110a',
    '96266510-ae90-4308-b1fe-c6a2a4f144f9',
    'a4db3727-13b2-4d28-b720-0c5edf320a09',
    'f28395d2-7a3b-4a06-9148-d473f07e0865',
    'a398efe0-1389-4346-960a-88ccb863960e',
    '74f4f53d-8590-4115-bb07-9fc0d9090f23',
    '714ff08b-df9a-452e-85fa-29a6b457792d',
    '5a88655f-6ae3-4686-a08e-76d619d7afa0',
    '3c7367eb-49eb-417c-929e-2a2dc30e8075',
    '5fb56bd3-f435-42d9-9158-a98d9ca6db5c',
    'ff900b92-6061-4d5a-8e40-3b5a6c87ef44',
    '488fe8f0-1621-4451-b089-9b0378e8b1e9',
    '23b61a5a-ce22-40ba-941f-9631a0cf2a0e',
    '0be53b5e-bae1-41ab-b990-acfaa9ae066c',
    'c23c64fe-35bb-46d0-91ad-6f2c33ee5e21',
    'd1b1c072-8c04-4a14-a5e7-62aa4417702d',
    '86051360-834c-4919-a2e9-b60c2bf7afdc',
    'd7a527e5-2b2d-42b1-8e07-2f0e6f0ca12a',
    'f58cad7d-7610-4f34-af17-5c957441e305',
    '7198b288-c1fe-455c-a774-f6bdd086792b',
    '6945b363-98e0-4ae4-8577-22fd16f66bf2',
    '0beaf87b-1139-4f80-9b34-d52184ffbb58',
    'e85c7d5b-1b8d-41cd-b7c9-0a2775edd4f3',
    'dbae5e78-13a9-4095-968b-4de4d2b086d6',
    'ef06fc6f-06e0-4de4-a2d5-37373e3eec78',
    '29f0d526-504a-4471-992b-52df34f24abb',
    '2715d02e-5bc2-4bc0-b299-2210b7eee0ac',
    'ba97202a-b3d1-4979-b935-011b5392ddbd',
    '8d883488-0acb-41eb-b699-49c2a9d76189',
    '0ee88d3e-405a-4571-910b-aa6d3108d109',
    'efc07387-4fbc-47ce-b33d-eadb44af0a7d',
    '2200155a-b85c-4497-b198-3ec73af86ecc'
  ]::text[];
  v_present int; v_rows int; v_prev text; v_runtime_before jsonb;
  v_target_before text; v_target_after text;
  v_rest_before text; v_rest_after text;
begin
  if cardinality(v_ids) <> 35 or (select count(distinct x) from unnest(v_ids) x) <> 35 then
    raise exception 'H175_ID_LIST_INVALID';
  end if;
  select count(*) into v_present from pos.products where id = any(v_ids);
  if v_present = 0 then return; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  if auth.uid() is not null then raise exception 'H175_UNEXPECTED_USER_CONTEXT'; end if;
  if (select count(*) from pos.products
      where id = any(v_ids) and deleted_at is null and record_model = 'v2'
        and nombre = 'TIRA BORDADA' and modelo = '0TB' and attrs->>'producto' = 'TB') <> 35 then
    raise exception 'H175_PRECONDITION_MISMATCH';
  end if;
  if exists(select 1 from pos.products
      where deleted_at is null and record_model = 'v2' and coalesce(attrs->>'producto', '') <> ''
        and modelo is distinct from attrs->>'producto' and not (id = any(v_ids))) then
    raise exception 'H175_UNEXPECTED_MODEL_MISMATCH';
  end if;

  select md5(string_agg((to_jsonb(p) - 'modelo' - 'sync_version' - 'updated_at')::text, '|' order by p.id))
    into v_target_before from pos.products p where p.id = any(v_ids);
  select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), ''))
    into v_rest_before from pos.products p where not (p.id = any(v_ids));

  -- La guarda de identidad protege `modelo`; el bypass interno se limita a
  -- esta sentencia. La versión avanza explícitamente para que un equipo con la
  -- fila anterior no pueda reenviar '0TB' sin conflicto de versión.
  -- Patrón H-164 (verificaciones 021300/021500/021700): la guarda online se
  -- suspende sólo dentro de esta transacción y se restaura byte a byte;
  -- ningún otro equipo observa el estado intermedio (MVCC).
  select to_jsonb(r) into v_runtime_before from pos.online_runtime r where singleton;
  update pos.online_runtime set enabled = false where singleton;
  v_prev := coalesce(current_setting('pos.h133_internal', true), '');
  perform set_config('pos.h133_internal', 'on', true);
  update pos.products
     set modelo = 'TB', sync_version = sync_version + 1, updated_at = now()
   where id = any(v_ids) and modelo = '0TB';
  get diagnostics v_rows = row_count;
  perform set_config('pos.h133_internal', v_prev, true);
  update pos.online_runtime set enabled = (v_runtime_before->>'enabled')::boolean where singleton;
  if (select to_jsonb(r) from pos.online_runtime r where singleton) is distinct from v_runtime_before then
    raise exception 'H175_RUNTIME_NOT_RESTORED';
  end if;
  if v_rows <> 35 then raise exception 'H175_UPDATE_COUNT_MISMATCH: %', v_rows; end if;

  select md5(string_agg((to_jsonb(p) - 'modelo' - 'sync_version' - 'updated_at')::text, '|' order by p.id))
    into v_target_after from pos.products p where p.id = any(v_ids);
  select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), ''))
    into v_rest_after from pos.products p where not (p.id = any(v_ids));
  if v_target_after is distinct from v_target_before then raise exception 'H175_OTHER_COLUMNS_CHANGED'; end if;
  if v_rest_after is distinct from v_rest_before then raise exception 'H175_OTHER_PRODUCTS_CHANGED'; end if;
  if (select count(*) from pos.products where id = any(v_ids) and modelo = 'TB') <> 35 then
    raise exception 'H175_RESULT_MISMATCH';
  end if;
  if exists(select 1 from pos.products
      where deleted_at is null and record_model = 'v2' and coalesce(attrs->>'producto', '') <> ''
        and modelo is distinct from attrs->>'producto') then
    raise exception 'H175_MISMATCH_REMAINS';
  end if;
  if coalesce(current_setting('pos.h133_internal', true), '') = 'on' then
    raise exception 'H175_INTERNAL_BYPASS_LEFT_ON';
  end if;
end;
$h175$;
commit;

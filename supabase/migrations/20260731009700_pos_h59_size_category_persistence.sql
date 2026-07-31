-- POS Balam — H-59: persistencia canónica de categoría de talla.
--
-- Alcance autorizado:
--   * exactamente los 240 productos de la auditoría H-59;
--   * única modificación funcional: attrs.__sizeCategoryId = size_number;
--   * sin modificar existencias, variantes, tallas, SKU, precios, nombres
--     ni tablas históricas.
--
-- La huella de IDs se calculó sobre:
--   string_agg(char_length(id) || ':' || id, '|' order by id)
-- y evita que una tabla con otros 240 productos pueda entrar al alcance.
--
-- Idempotencia:
--   * la primera ejecución actualiza sólo filas sin la categoría canónica;
--   * una repetición encuentra 0 candidatas y no incrementa versiones;
--   * cualquier categoría explícita distinta de size_number aborta.

begin;

set local transaction isolation level serializable;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

lock table pos.products in share row exclusive mode;

do $$
declare
  v_expected_count constant integer := 240;
  v_expected_id_md5 constant text := '47fae1aa86a3badec6622ad6b6db2ebb';
  v_expected_positive_products constant integer := 237;
  v_expected_stock_units constant numeric := 3505;
  v_category_id constant text := 'size_number';

  v_found_count integer;
  v_id_md5 text;
  v_positive_products integer;
  v_stock_units numeric;
  v_incompatible integer;
  v_candidates integer;
  v_modified integer;
  v_final_count integer;
  v_before_state jsonb;
  v_after_state jsonb;
  v_products_before_md5 text;
  v_products_after_md5 text;
  v_stock_before_md5 text;
  v_stock_after_md5 text;
  v_movements_before_count bigint;
  v_movements_after_count bigint;
  v_movements_before_md5 text;
  v_movements_after_md5 text;
begin
  -- Estados históricos de Configuración pueden contener el catálogo estable
  -- sin los campos sizeCategory/sizeScale, que H-59 rellena al cargar. La
  -- ausencia se acepta por compatibilidad; un valor explícito incompatible no.
  if not exists (
    select 1
      from pos.settings s
     where s.key = '_catalogMeta'
       and s.value ? v_category_id
  ) then
    raise exception
      'H-59 abortada: % no existe en los metadatos de Configuración',
      v_category_id;
  end if;

  if exists (
    select 1
      from pos.settings s
     where s.key = '_catalogMeta'
       and (
         (
           s.value -> v_category_id ? 'sizeCategory'
           and not (s.value -> v_category_id ->> 'sizeCategory')::boolean
         )
         or (
           s.value -> v_category_id ? 'sizeScale'
           and s.value -> v_category_id ->> 'sizeScale' <> 'N'
         )
       )
  ) then
    raise exception
      'H-59 abortada: % tiene metadatos explícitos incompatibles con la escala N',
      v_category_id;
  end if;

  if not exists (
    select 1
      from pos.lookup l
     where l.kind = v_category_id
  ) then
    raise exception
      'H-59 abortada: el catálogo estable % no existe en Configuración',
      v_category_id;
  end if;

  select
    count(*),
    md5(string_agg(char_length(p.id)::text || ':' || p.id, '|' order by p.id))
    into v_found_count, v_id_md5
    from pos.products p;

  if v_found_count <> v_expected_count or v_id_md5 <> v_expected_id_md5 then
    raise exception
      'H-59 abortada: conjunto distinto al auditado (esperados %, encontrados %, huella esperada %, huella encontrada %)',
      v_expected_count, v_found_count, v_expected_id_md5, v_id_md5;
  end if;

  if exists (select 1 from pos.products where deleted_at is not null) then
    raise exception
      'H-59 abortada: el conjunto auditado ahora contiene productos eliminados';
  end if;

  select
    count(*) filter (
      where exists (
        select 1
          from jsonb_array_elements(coalesce(p.stock, '[]'::jsonb)) item
         where coalesce((item ->> 'stock')::numeric, 0) > 0
      )
    ),
    coalesce(sum((
      select coalesce(sum(greatest(coalesce((item ->> 'stock')::numeric, 0), 0)), 0)
        from jsonb_array_elements(coalesce(p.stock, '[]'::jsonb)) item
    )), 0)
    into v_positive_products, v_stock_units
    from pos.products p;

  if v_positive_products <> v_expected_positive_products
     or v_stock_units <> v_expected_stock_units then
    raise exception
      'H-59 abortada: inventario distinto al auditado (productos positivos %/%; unidades %/%)',
      v_positive_products, v_expected_positive_products,
      v_stock_units, v_expected_stock_units;
  end if;

  if exists (
    with confirmed(id, nombre) as (
      values
        ('imp-1784582003846-41'::text, 'BRAULIO'::text),
        ('imp-1784582003845-31'::text, 'DANTE'::text),
        ('imp-1784582003849-56'::text, 'VALERIO'::text)
    )
    select 1
      from confirmed c
      left join pos.products p
        on p.id = c.id
       and p.nombre = c.nombre
     where p.id is null
        or exists (
          select 1
            from jsonb_array_elements(coalesce(p.stock, '[]'::jsonb)) item
           where coalesce((item ->> 'stock')::numeric, 0) <> 0
        )
  ) then
    raise exception
      'H-59 abortada: BRAULIO, DANTE o VALERIO no coincide o ya no tiene stock cero';
  end if;

  select count(*)
    into v_incompatible
    from pos.products p
   where p.attrs ->> '__sizeCategoryId' is not null
     and p.attrs ->> '__sizeCategoryId' <> v_category_id;

  if v_incompatible <> 0 then
    raise exception
      'H-59 abortada: % producto(s) ya tienen una categoría explícita incompatible',
      v_incompatible;
  end if;

  select coalesce(
    jsonb_object_agg(category_id, amount order by category_id),
    '{}'::jsonb
  )
    into v_before_state
    from (
      select
        coalesce(p.attrs ->> '__sizeCategoryId', '<sin categoría>') category_id,
        count(*) amount
        from pos.products p
       group by 1
    ) state;

  select
    md5(coalesce(string_agg(
      (
        (to_jsonb(p) - 'attrs' - 'sync_version' - 'updated_at')
        || jsonb_build_object(
          'attrs',
          coalesce(p.attrs, '{}'::jsonb) - '__sizeCategoryId'
        )
      )::text,
      '|' order by p.id
    ), '')),
    md5(coalesce(string_agg(
      jsonb_build_object('id', p.id, 'stock', p.stock)::text,
      '|' order by p.id
    ), ''))
    into v_products_before_md5, v_stock_before_md5
    from pos.products p;

  select
    count(*),
    md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.id), ''))
    into v_movements_before_count, v_movements_before_md5
    from pos.movements m;

  select count(*)
    into v_candidates
    from pos.products p
   where p.attrs ->> '__sizeCategoryId' is distinct from v_category_id;

  update pos.products p
     set attrs = jsonb_set(
           coalesce(p.attrs, '{}'::jsonb),
           '{__sizeCategoryId}',
           to_jsonb(v_category_id),
           true
         ),
         -- Cumple el contrato del trigger de concurrencia. El propio trigger
         -- incrementa sync_version, limpia sync_base_version y actualiza
         -- updated_at sólo para las filas realmente modificadas.
         sync_base_version = p.sync_version
   where p.attrs ->> '__sizeCategoryId' is distinct from v_category_id;

  get diagnostics v_modified = row_count;

  if v_modified <> v_candidates then
    raise exception
      'H-59 abortada: candidatas % pero modificadas %',
      v_candidates, v_modified;
  end if;

  select count(*)
    into v_final_count
    from pos.products p
   where p.attrs ->> '__sizeCategoryId' = v_category_id;

  if v_final_count <> v_expected_count then
    raise exception
      'H-59 abortada: estado posterior incompleto (%/% con %)',
      v_final_count, v_expected_count, v_category_id;
  end if;

  select coalesce(
    jsonb_object_agg(category_id, amount order by category_id),
    '{}'::jsonb
  )
    into v_after_state
    from (
      select
        coalesce(p.attrs ->> '__sizeCategoryId', '<sin categoría>') category_id,
        count(*) amount
        from pos.products p
       group by 1
    ) state;

  select
    md5(coalesce(string_agg(
      (
        (to_jsonb(p) - 'attrs' - 'sync_version' - 'updated_at')
        || jsonb_build_object(
          'attrs',
          coalesce(p.attrs, '{}'::jsonb) - '__sizeCategoryId'
        )
      )::text,
      '|' order by p.id
    ), '')),
    md5(coalesce(string_agg(
      jsonb_build_object('id', p.id, 'stock', p.stock)::text,
      '|' order by p.id
    ), ''))
    into v_products_after_md5, v_stock_after_md5
    from pos.products p;

  select
    count(*),
    md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.id), ''))
    into v_movements_after_count, v_movements_after_md5
    from pos.movements m;

  if v_products_after_md5 <> v_products_before_md5 then
    raise exception
      'H-59 abortada: cambió un campo funcional distinto de attrs.__sizeCategoryId';
  end if;

  if v_stock_after_md5 <> v_stock_before_md5 then
    raise exception
      'H-59 abortada: cambiaron existencias o variantes';
  end if;

  if v_movements_after_count <> v_movements_before_count
     or v_movements_after_md5 <> v_movements_before_md5 then
    raise exception
      'H-59 abortada: cambió el historial de movimientos';
  end if;

  raise notice
    'H-59 aplicada: esperados=%, encontrados=%, modificados=%, omitidos=0, antes=%, después=%, stock=% unidades/% productos positivos, movimientos=%',
    v_expected_count, v_found_count, v_modified,
    v_before_state, v_after_state,
    v_stock_units, v_positive_products, v_movements_after_count;
end;
$$;

commit;

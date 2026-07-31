-- POS Balam — Verificación posterior H-59.
--
-- No modifica datos funcionales. Falla si el conjunto, la categoría, el
-- inventario o los historiales auditados no conservan el estado aprobado.

begin;

set local transaction isolation level serializable;
set local statement_timeout = '60s';

do $$
declare
  v_count integer;
  v_id_md5 text;
  v_positive_products integer;
  v_stock_units numeric;
  v_zero_products integer;
  v_idempotent_candidates integer;
begin
  select
    count(*),
    md5(string_agg(char_length(p.id)::text || ':' || p.id, '|' order by p.id))
    into v_count, v_id_md5
    from pos.products p;

  if v_count <> 240
     or v_id_md5 <> '47fae1aa86a3badec6622ad6b6db2ebb' then
    raise exception
      'H-59 verificación: conjunto inesperado (% filas, huella %)',
      v_count, v_id_md5;
  end if;

  select count(*)
    into v_count
    from pos.products p
   where p.attrs ->> '__sizeCategoryId' = 'size_number';

  if v_count <> 240 then
    raise exception
      'H-59 verificación: sólo %/240 productos tienen size_number',
      v_count;
  end if;

  select count(*)
    into v_idempotent_candidates
    from pos.products p
   where p.attrs ->> '__sizeCategoryId' is distinct from 'size_number';

  if v_idempotent_candidates <> 0 then
    raise exception
      'H-59 verificación: una repetición modificaría % filas',
      v_idempotent_candidates;
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

  if v_positive_products <> 237 or v_stock_units <> 3505 then
    raise exception
      'H-59 verificación: inventario inesperado (% productos positivos, % unidades)',
      v_positive_products, v_stock_units;
  end if;

  select count(*)
    into v_zero_products
    from pos.products p
   where (p.id, p.nombre) in (
     ('imp-1784582003846-41', 'BRAULIO'),
     ('imp-1784582003845-31', 'DANTE'),
     ('imp-1784582003849-56', 'VALERIO')
   )
     and not exists (
       select 1
         from jsonb_array_elements(coalesce(p.stock, '[]'::jsonb)) item
        where coalesce((item ->> 'stock')::numeric, 0) <> 0
     );

  if v_zero_products <> 3 then
    raise exception
      'H-59 verificación: sólo %/3 productos confirmados conservan stock cero',
      v_zero_products;
  end if;

  if (select count(*) from pos.movements) <> 22
     or (select count(*) from pos.sale_items) <> 21
     or (select count(*) from pos.exchange_items) <> 2
     or (select count(*) from pos.return_items) <> 1
     or (select count(*) from pos.loan_documents) <> 0 then
    raise exception
      'H-59 verificación: cambió el conteo de algún historial auditado';
  end if;

  if not exists (select 1 from pos.lookup where kind = 'size_number')
     or not exists (select 1 from pos.lookup where kind = 'size_letter') then
    raise exception
      'H-59 verificación: los catálogos de letra y número no permanecen separados';
  end if;

  raise notice
    'H-59 verificada: 240/240 size_number; repetición=0 cambios; stock=3505/237; BRAULIO-DANTE-VALERIO=0; historiales=22 movimientos,21 ventas,2 cambios,1 devolución,0 préstamos';
end;
$$;

commit;

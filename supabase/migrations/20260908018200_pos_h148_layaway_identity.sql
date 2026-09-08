-- H-148: preserve frozen V2 identity when liquidating a layaway.
-- Generated from pg_get_functiondef on the linked project; one block only.
-- No data backfill, new privileges, RPC signature or financial calculation.
begin;
do $migration$
declare
  v_signature regprocedure := 'pos.commit_layaway_liquidation(text,text,text,jsonb,jsonb,jsonb)'::regprocedure;
  v_definition text;
  v_before constant text := '4898c3d7516d2818f5fb4be541cb632e';
  v_after constant text := 'cf66ef2e110f9ea197860f3409b072c7';
begin
  v_definition := pg_get_functiondef(v_signature);
  if md5(v_definition) = v_after then return; end if;
  if md5(v_definition) <> v_before then
    raise exception 'H148_LAYAWAY_DEFINITION_DRIFT';
  end if;
  v_definition := replace(v_definition, $old$  -- commit_sale vigente antecede a H-52: al reemplazar sale_items no transporta
  -- descuento_adicional. Se reescribe el mismo snapshot derivado, todavia dentro
  -- de esta transaccion, sin invocar claim_physical_card ni consumirlo de nuevo.
  delete from pos.sale_items where folio = p_folio;
  insert into pos.sale_items (
    folio, product_id, sku, nombre, talla, qty, precio,
    precio_base, precio_original, promos, descuento_adicional
  )
  select p_folio, x.product_id, x.sku, x.nombre, x.talla, x.qty, x.precio,
         x.precio_base, x.precio_original, x.promos, x.descuento_adicional
    from jsonb_to_recordset(v_items) as x(
      folio text, product_id text, sku text, nombre text, talla text,
      qty integer, precio numeric, precio_base numeric,
      precio_original numeric, promos jsonb, descuento_adicional numeric
    );
$old$, $new$  -- Preserve the complete frozen line snapshot through liquidation (H-148).
  -- No new pricing, identity resolution or physical-card consumption occurs here.
  delete from pos.sale_items where folio = p_folio;
  insert into pos.sale_items (
    folio, product_id, sku, nombre, talla, qty, precio,
    precio_base, precio_original, promos, descuento_adicional,
    line_id, barcode_code, physical_attrs, list_price, effective_price,
    discount_snapshot, ornamento, orn_colors
  )
  select p_folio, x.product_id, x.sku, x.nombre, x.talla, x.qty, x.precio,
         x.precio_base, x.precio_original, x.promos, x.descuento_adicional,
         x.line_id, x.barcode_code, x.physical_attrs, x.list_price, x.effective_price,
         x.discount_snapshot, x.ornamento, x.orn_colors
    from jsonb_to_recordset(v_items) as x(
      folio text, product_id text, sku text, nombre text, talla text,
      qty integer, precio numeric, precio_base numeric,
      precio_original numeric, promos jsonb, descuento_adicional numeric,
      line_id text, barcode_code text, physical_attrs jsonb, list_price numeric,
      effective_price numeric, discount_snapshot jsonb, ornamento text, orn_colors jsonb
    );
$new$);
  if md5(v_definition) <> v_after then raise exception 'H148_LAYAWAY_PATCH_MISMATCH'; end if;
  execute v_definition;
  if md5(pg_get_functiondef(v_signature)) <> v_after then raise exception 'H148_LAYAWAY_INSTALL_MISMATCH'; end if;
end;
$migration$;
commit;

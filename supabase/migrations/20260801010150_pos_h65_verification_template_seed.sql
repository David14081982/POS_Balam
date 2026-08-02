-- H-65: plantilla tecnica minima para verificaciones en una instalacion limpia.
--
-- Las verificaciones 102 y 104 clonan una fila de pos.products para no copiar
-- a mano un esquema que evoluciona. Produccion ya tiene productos y esta
-- migracion es un no-op. Una cadena limpia no los tiene despues de H-10, por lo
-- que se crea una unica plantilla reservada y 10450 la elimina exactamente.

begin;

do $$
begin
  if exists (
    select 1 from pos.products
     where id = '__h65_verification_template__'
  ) then
    raise exception 'H65_VERIFICATION_TEMPLATE_ID_COLLISION';
  end if;

  if not exists (
    select 1 from pos.products where deleted_at is null
  ) then
    insert into pos.products(
      id,cat,manga,tela,color,cuello,modelo,nombre,orn,orn_colors,
      precio,pop,stock,imagen,sku,barcode_urls,costo,attrs,precios_talla,
      sync_base_version,sync_device_id,deleted_at
    ) values (
      '__h65_verification_template__','__H65_VERIFY__','__H65_VERIFY__',
      '__H65_VERIFY__','__H65_VERIFY__','NOR','__H65_VERIFY__',
      'Plantilla tecnica H65','-', '[]'::jsonb,0,false,
      '[{"talla":"M","escala":"L","stock":0}]'::jsonb,null,
      '__H65_VERIFICATION_TEMPLATE__','{}'::jsonb,0,'{}'::jsonb,'{}'::jsonb,
      null,'migration:h65-verification-template',null
    );

    if not exists (
      select 1 from pos.products
       where id = '__h65_verification_template__'
         and sku = '__H65_VERIFICATION_TEMPLATE__'
         and cat = '__H65_VERIFY__'
         and sync_device_id = 'migration:h65-verification-template'
         and deleted_at is null
    ) then
      raise exception 'H65_VERIFICATION_TEMPLATE_SEED_FAILED';
    end if;
  end if;
end;
$$;

commit;

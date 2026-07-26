-- POS Balam — H-06: verificación remota autocontenida de versiones y tombstones.

do $$
declare
  v_product pos.products%rowtype;
  v_client pos.clients%rowtype;
  v_seller pos.sellers%rowtype;
  v_admin_email text;
  v_prefix text := 'h06-remote-verify-20260725';
begin
  select email into v_admin_email
    from pos.sellers
   where role = 'admin' and active is true and deleted_at is null
     and nullif(trim(email), '') is not null
   limit 1;
  select * into v_product from pos.products where deleted_at is null limit 1;
  select * into v_client from pos.clients where deleted_at is null limit 1;
  select * into v_seller from pos.sellers where deleted_at is null limit 1;
  if v_admin_email is null
     or v_product.id is null or v_client.id is null or v_seller.id is null then
    raise exception 'H-06 requiere semillas activas para su verificación remota';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'authenticated',
      'email', v_admin_email,
      'sub', '00000000-0000-0000-0000-000000000026'
    )::text,
    true
  );

  v_product.id := v_prefix || '-product';
  v_product.sku := upper(v_prefix || '-sku');
  v_product.nombre := 'H06 producto base';
  v_product.sync_version := 0;
  v_product.sync_base_version := 0;
  v_product.sync_device_id := 'h06-seed';
  v_product.deleted_at := null;
  insert into pos.products values (v_product.*);

  v_client.id := v_prefix || '-client';
  v_client.nombre := 'H06 cliente base';
  v_client.email := 'h06-client@invalid.local';
  v_client.sync_version := 0;
  v_client.sync_base_version := 0;
  v_client.sync_device_id := 'h06-seed';
  v_client.deleted_at := null;
  insert into pos.clients values (v_client.*);

  v_seller.id := v_prefix || '-seller';
  v_seller.nombre := 'H06 vendedor base';
  v_seller.email := 'h06-seller@invalid.local';
  v_seller.role := 'vendedor';
  v_seller.active := true;
  v_seller.sync_version := 0;
  v_seller.sync_base_version := 0;
  v_seller.sync_device_id := 'h06-seed';
  v_seller.deleted_at := null;
  insert into pos.sellers values (v_seller.*);

  insert into pos.promotions (
    id, nombre, tipo, valor, pausado, scope, creado,
    sync_version, sync_base_version, sync_device_id, deleted_at
  ) values (
    v_prefix || '-promotion', 'H06 promoción base', 'pct', 5, false, '{}', 1,
    0, 0, 'h06-seed', null
  );

  if (select sync_version from pos.products where id = v_product.id) <> 1
     or (select sync_version from pos.clients where id = v_client.id) <> 1
     or (select sync_version from pos.sellers where id = v_seller.id) <> 1
     or (select sync_version from pos.promotions
          where id = v_prefix || '-promotion') <> 1 then
    raise exception 'H-06 no inicializó las cuatro entidades en versión 1';
  end if;

  -- Terminal A confirma primero desde la versión que ambas leyeron.
  update pos.products
     set nombre = 'H06 producto terminal A',
         sync_base_version = 1, sync_device_id = 'h06-device-a'
   where id = v_product.id;
  update pos.clients
     set nombre = 'H06 cliente terminal A',
         sync_base_version = 1, sync_device_id = 'h06-device-a'
   where id = v_client.id;
  update pos.sellers
     set nombre = 'H06 vendedor terminal A',
         sync_base_version = 1, sync_device_id = 'h06-device-a'
   where id = v_seller.id;
  update pos.promotions
     set nombre = 'H06 promoción terminal A',
         sync_base_version = 1, sync_device_id = 'h06-device-a'
   where id = v_prefix || '-promotion';

  -- Terminal B conserva el snapshot base=1: sus cuatro escrituras deben
  -- terminar con éxito SQL, devolver/conservar A y producir auditoría.
  update pos.products
     set nombre = 'H06 producto terminal B',
         sync_base_version = 1, sync_device_id = 'h06-device-b'
   where id = v_product.id;
  update pos.clients
     set nombre = 'H06 cliente terminal B',
         sync_base_version = 1, sync_device_id = 'h06-device-b'
   where id = v_client.id;
  update pos.sellers
     set nombre = 'H06 vendedor terminal B',
         sync_base_version = 1, sync_device_id = 'h06-device-b'
   where id = v_seller.id;
  update pos.promotions
     set nombre = 'H06 promoción terminal B',
         sync_base_version = 1, sync_device_id = 'h06-device-b'
   where id = v_prefix || '-promotion';

  if (select nombre from pos.products where id = v_product.id)
       <> 'H06 producto terminal A'
     or (select nombre from pos.clients where id = v_client.id)
       <> 'H06 cliente terminal A'
     or (select nombre from pos.sellers where id = v_seller.id)
       <> 'H06 vendedor terminal A'
     or (select nombre from pos.promotions where id = v_prefix || '-promotion')
       <> 'H06 promoción terminal A'
     or (select sync_version from pos.products where id = v_product.id) <> 2
     or (select sync_version from pos.clients where id = v_client.id) <> 2
     or (select sync_version from pos.sellers where id = v_seller.id) <> 2
     or (select sync_version from pos.promotions
          where id = v_prefix || '-promotion') <> 2 then
    raise exception 'H-06 permitió que la terminal B sobrescribiera a A';
  end if;

  -- Tombstone confirmado por A; el snapshot anterior de B no puede revivirlo.
  update pos.promotions
     set deleted_at = now(),
         sync_base_version = 2, sync_device_id = 'h06-device-a'
   where id = v_prefix || '-promotion';
  update pos.promotions
     set deleted_at = null,
         nombre = 'H06 promoción revivida por B',
         sync_base_version = 2, sync_device_id = 'h06-device-b'
   where id = v_prefix || '-promotion';

  if not coalesce((select deleted_at is not null from pos.promotions
                    where id = v_prefix || '-promotion'), false)
     or (select sync_version from pos.promotions
          where id = v_prefix || '-promotion') <> 3 then
    raise exception 'H-06 permitió revivir un tombstone desde un snapshot viejo';
  end if;

  if (select count(*) from pos.sync_conflicts
       where entity_id like v_prefix || '-%') <> 5
     or (select count(*) from pos.sync_conflicts
          where entity_id like v_prefix || '-%'
            and expected_version = 1 and actual_version = 2
            and device_id = 'h06-device-b') <> 4
     or not exists (
       select 1 from pos.sync_conflicts
        where entity = 'promotions'
          and entity_id = v_prefix || '-promotion'
          and expected_version = 2 and actual_version = 3
          and operation = 'upsert'
          and device_id = 'h06-device-b'
     ) then
    raise exception 'H-06 no registró la auditoría exacta de los conflictos';
  end if;

  delete from pos.sync_conflicts where entity_id like v_prefix || '-%';
  delete from pos.promotions where id = v_prefix || '-promotion';
  delete from pos.products where id = v_product.id;
  delete from pos.clients where id = v_client.id;
  delete from pos.sellers where id = v_seller.id;
end;
$$;

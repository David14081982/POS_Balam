-- POS Balam — H-05: identidad administrativa temporal para verificar contraseña.
-- La migración 028 elimina esta fixture después de la prueba remota.

do $$
declare
  v_email text := 'h05.bootstrap.20260725@gmail.com';
  -- En una reconstrucción futura la fixture recibe un secreto no predecible y
  -- la 028 la elimina inmediatamente. La contraseña usada en la prueba original
  -- nunca queda versionada.
  v_password text := encode(extensions.gen_random_bytes(32), 'hex');
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = lower(v_email);

  if v_user_id is null then
    v_user_id := '00000000-0000-0000-0000-000000000005'::uuid;
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000'::uuid,
      v_user_id, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now()
    );

    insert into auth.identities (
      id, provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      v_user_id, v_user_id::text, v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      'email', now(), now(), now()
    );
  else
    update auth.users
       set encrypted_password = extensions.crypt(
             v_password, extensions.gen_salt('bf')
           ),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
           updated_at = now()
     where id = v_user_id;
  end if;

  insert into pos.sellers (
    id, nombre, iniciales, color, comision_pct, meta_mes, ventas_mes,
    ventas_num, comision_acum, bono, email, role, active,
    sync_base_version, sync_device_id, deleted_at
  ) values (
    v_user_id::text, 'Administrador temporal H05', 'H5', '#64748b',
    0, 0, 0, 0, 0, 'Sin bono', v_email, 'admin', true,
    0, 'h05-verification', null
  )
  on conflict (id) do update set
    nombre = excluded.nombre,
    email = excluded.email,
    role = 'admin',
    active = true,
    deleted_at = null,
    sync_base_version = pos.sellers.sync_version,
    sync_device_id = 'h05-verification';
end;
$$;

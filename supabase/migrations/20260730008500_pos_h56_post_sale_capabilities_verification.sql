-- H-56 Fase 5 grupo 2: verificación remota autocontenida.

begin;

do $$
declare
  v_admin constant uuid := '00000000-0000-0000-0000-000000005671';
  v_seller constant uuid := '00000000-0000-0000-0000-000000005672';
  v_result jsonb;
  v_rejected boolean;
  v_actor uuid;
  v_email text;
begin
  if exists (select 1 from auth.users where id in (v_admin, v_seller))
     or exists (select 1 from pos.sellers
                where id in ('h56-postsale-admin', 'h56-postsale-seller')) then
    raise exception 'H56_POSTSALE_FIXTURE_COLLISION';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin,
     'authenticated', 'authenticated', 'h56.postsale.admin@invalid.local',
     '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_seller,
     'authenticated', 'authenticated', 'h56.postsale.seller@invalid.local',
     '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
  insert into pos.sellers(id, nombre, email, role, active)
  values
    ('h56-postsale-admin', 'Admin Fixture',
     'h56.postsale.admin@invalid.local', 'admin', true),
    ('h56-postsale-seller', 'Seller Fixture',
     'h56.postsale.seller@invalid.local', 'vendedor', true);
  insert into pos.user_permission_role_assignments(user_id, role_code, active)
  values (v_admin, 'admin', true), (v_seller, 'vendedor', true);

  -- Compatibilidad: admin y vendedor atraviesan la capacidad y reciben el
  -- error de forma del contrato comercial, no una denegación.
  foreach v_actor in array array[v_admin, v_seller] loop
    v_email := case when v_actor = v_admin
      then 'h56.postsale.admin@invalid.local'
      else 'h56.postsale.seller@invalid.local' end;
    perform set_config('request.jwt.claim.sub', v_actor::text, true);
    perform set_config('request.jwt.claim.email', v_email, true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', v_actor::text,
        'email', v_email,
        'role', 'authenticated',
        'aud', 'authenticated'
      )::text,
      true
    );
    v_result := pos.commit_return_checked(
      'h56-invalid', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
    );
    if v_result ->> 'error' <> 'invalid_request' then
      raise exception 'H56_POSTSALE_COMPATIBILITY_FAILED';
    end if;
    v_result := pos.commit_exchange_checked(
      'h56-invalid', '{}'::jsonb, '[]'::jsonb
    );
    if v_result ->> 'error' <> 'invalid_request' then
      raise exception 'H56_POSTSALE_COMPATIBILITY_FAILED';
    end if;
  end loop;

  insert into pos.user_capability_overrides(user_id, capability_key, effect)
  values
    (v_seller, 'sales.refund', 'deny'),
    (v_seller, 'sales.exchange', 'deny');
  perform set_config('request.jwt.claim.sub', v_seller::text, true);
  perform set_config(
    'request.jwt.claim.email', 'h56.postsale.seller@invalid.local', true
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_seller::text,
      'email', 'h56.postsale.seller@invalid.local',
      'role', 'authenticated',
      'aud', 'authenticated'
    )::text,
    true
  );
  v_rejected := false;
  begin
    perform pos.commit_return_checked(
      'h56-denied', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
    );
  exception when sqlstate '42501' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'H56_POSTSALE_UNAUTHORIZED_FAILED'; end if;
  v_rejected := false;
  begin
    perform pos.commit_exchange_checked(
      'h56-denied', '{}'::jsonb, '[]'::jsonb
    );
  exception when sqlstate '42501' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'H56_POSTSALE_UNAUTHORIZED_FAILED'; end if;

  -- Una identidad cuyo sub y correo no pertenecen a la misma cuenta tampoco
  -- puede atravesar ambas autoridades.
  delete from pos.user_capability_overrides where user_id = v_seller;
  perform set_config('request.jwt.claim.email',
    'h56.postsale.mismatch@invalid.local', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_seller::text,
      'email', 'h56.postsale.mismatch@invalid.local',
      'role', 'authenticated',
      'aud', 'authenticated'
    )::text,
    true
  );
  v_rejected := false;
  begin
    perform pos.commit_return_checked(
      'h56-mismatch', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
    );
  exception when sqlstate '42501' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'H56_POSTSALE_IDENTITY_MISMATCH_FAILED'; end if;

  if has_function_privilege('authenticated',
       'pos.commit_return(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)', 'execute')
     or has_function_privilege('authenticated',
       'pos.commit_exchange(text,jsonb,jsonb,jsonb,jsonb,jsonb)', 'execute')
     or not has_function_privilege('authenticated',
       'pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)', 'execute')
     or not has_function_privilege('authenticated',
       'pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)', 'execute')
     or has_function_privilege('anon',
       'pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)', 'execute')
     or has_function_privilege('anon',
       'pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)', 'execute') then
    raise exception 'H56_POSTSALE_ACL_FAILED';
  end if;

  delete from pos.user_capability_overrides where user_id = v_seller;
  delete from pos.user_permission_role_assignments
  where user_id in (v_admin, v_seller);
  delete from pos.sellers
  where id in ('h56-postsale-admin', 'h56-postsale-seller');
  delete from auth.users where id in (v_admin, v_seller);
  if exists (select 1 from auth.users where id in (v_admin, v_seller))
     or exists (select 1 from pos.sellers
                where id in ('h56-postsale-admin', 'h56-postsale-seller'))
     or exists (select 1 from pos.user_capability_overrides
                where user_id in (v_admin, v_seller))
     or exists (select 1 from pos.user_permission_role_assignments
                where user_id in (v_admin, v_seller))
     or exists (select 1 from pos.capability_operation_audit
                where actor_user_id in (v_admin, v_seller)) then
    raise exception 'H56_POSTSALE_FIXTURE_CLEANUP_FAILED';
  end if;
  raise notice 'H56_POSTSALE auth=ok compatibility=ok acl=ok fixtures_clean=ok';
end;
$$;

commit;

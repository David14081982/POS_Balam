-- H166: execute conditional reads and invalidation; all fixtures roll back.
begin;
do $verify$
declare owner_role name:=current_user; actor uuid:=gen_random_uuid();
 baseline bigint; first_read jsonb; second_read jsonb; k text:='qa.h166.'||gen_random_uuid();
 relation text; before_change bigint;
begin
 if has_table_privilege('anon','pos.online_snapshot_revision','select')
  or has_table_privilege('authenticated','pos.online_snapshot_revision','update')
  or has_function_privilege('anon','pos.online_snapshot_if_changed(text)','execute')
  or has_function_privilege('authenticated','pos.h166_advance_snapshot_revision()','execute')
  or (select prosecdef from pg_proc where oid='pos.online_snapshot_if_changed(text)'::regprocedure)
  or not(select relrowsecurity from pg_class where oid='pos.online_snapshot_revision'::regclass) then
  raise exception 'H166_REVISION_ACL';
 end if;
 foreach relation in array array['products','clients','sellers','promotions','sales','sale_items',
 'sale_payments','returns','return_items','exchanges','exchange_items','loan_documents',
 'movements','liquidations','commission_adjustments','lookup','settings','config_sync_state',
 'stock_reservations','reference_reclassifications','online_legacy_operations','permission_roles',
 'user_permission_role_assignments','role_screen_permissions','user_screen_permission_overrides',
 'role_capability_permissions','screen_permission_catalog','screen_permission_catalog_state','online_runtime'] loop
  if not exists(select 1 from pg_trigger where tgrelid=('pos.'||relation)::regclass
    and tgname='h166_snapshot_changed' and tgenabled='O' and tgtype=60
    and tgfoid='pos.h166_advance_snapshot_revision()'::regprocedure) then
   raise exception 'H166_INVALIDATION_COVERAGE: %',relation;
  end if;
 end loop;
 select revision into baseline from pos.online_snapshot_revision;
 begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  perform set_config('request.headers','{}',true);
  update pos.online_runtime set enabled=false where singleton;
  insert into auth.users(id,email) values(actor,actor||'@h166.invalid');
  insert into pos.sellers(id,nombre,email,role,active)
   values(actor::text,'H166 rollback fixture',actor||'@h166.invalid','admin',true);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'email',actor||'@h166.invalid','role','authenticated')::text,true);
  set local role authenticated;
  first_read:=pos.online_snapshot_if_changed(null);
  if first_read->>'unchanged'<>'false' or not(first_read ? 'products') then raise exception 'H166_INITIAL_COMPLETE'; end if;
  second_read:=pos.online_snapshot_if_changed(first_read->>'snapshotRevision');
  if second_read->>'unchanged'<>'true' or second_read ? 'products'
   or second_read ? 'settings' or second_read->>'snapshotRevision'<>first_read->>'snapshotRevision' then
   raise exception 'H166_UNCHANGED_READ_NOT_LIGHTWEIGHT';
  end if;
  execute format('set local role %I',owner_role);
  insert into pos.settings(key,value) values(k,'"first"');
  set local role authenticated;
  second_read:=pos.online_snapshot_if_changed(first_read->>'snapshotRevision');
  if second_read->>'unchanged'<>'false' or not exists(select 1 from jsonb_array_elements(second_read->'settings') r where r->>'key'=k) then
   raise exception 'H166_CREATE_NOT_INVALIDATED';
  end if;
  first_read:=second_read;
  execute format('set local role %I',owner_role);
  update pos.settings set value='"second"' where key=k;
  set local role authenticated;
  second_read:=pos.online_snapshot_if_changed(first_read->>'snapshotRevision');
  if second_read->>'unchanged'<>'false' or not exists(select 1 from jsonb_array_elements(second_read->'settings') r where r->>'key'=k and r->>'value'='second') then
   raise exception 'H166_EDIT_NOT_INVALIDATED';
  end if;
  first_read:=second_read;
  execute format('set local role %I',owner_role);
  delete from pos.settings where key=k;
  set local role authenticated;
  second_read:=pos.online_snapshot_if_changed(first_read->>'snapshotRevision');
  if second_read->>'unchanged'<>'false' or exists(select 1 from jsonb_array_elements(second_read->'settings') r where r->>'key'=k) then
   raise exception 'H166_DELETE_NOT_INVALIDATED';
  end if;
  execute format('set local role %I',owner_role);
  -- Active session without a profile must not read the revision or reuse a token.
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'email','no-profile@h166.invalid','role','authenticated')::text,true);
  set local role authenticated;
  if exists(select 1 from pos.online_snapshot_revision) then raise exception 'H166_REVISION_PROFILE_LEAK'; end if;
  begin
   perform pos.online_snapshot_if_changed(first_read->>'snapshotRevision');
   raise exception 'H166_NO_PROFILE_READ';
  exception when insufficient_privilege then null; end;
  execute format('set local role %I',owner_role);
  -- Same authenticated actor, active seller: RLS must permit authorized reading.
  update pos.sellers set role='vendedor' where id=actor::text;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'email',actor||'@h166.invalid','role','authenticated')::text,true);
  set local role authenticated;
  second_read:=pos.online_snapshot_if_changed(null);
  if second_read->>'unchanged'<>'false' then raise exception 'H166_ACTIVE_SELLER_READ'; end if;
  begin update pos.online_snapshot_revision set revision=revision+1; raise exception 'H166_SELLER_WRITES_REVISION'; exception when insufficient_privilege then null; end;
  execute format('set local role %I',owner_role);
  perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
  update pos.sellers set role='admin',active=false where id=actor::text;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'email',actor||'@h166.invalid','role','authenticated')::text,true);
  set local role authenticated;
  if exists(select 1 from pos.online_snapshot_revision) then raise exception 'H166_INACTIVE_REVISION_READ'; end if;
  begin perform pos.online_snapshot_if_changed(null);raise exception 'H166_INACTIVE_SNAPSHOT';exception when insufficient_privilege then null;end;
  execute format('set local role %I',owner_role);
  perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
  set local role anon;
  begin perform pos.online_snapshot_if_changed(null);raise exception 'H166_ANON_SNAPSHOT';exception when insufficient_privilege then null;end;
  execute format('set local role %I',owner_role);
  set local role service_role;
  begin perform pos.online_snapshot_if_changed(null);raise exception 'H166_UNPROFILED_SERVICE_SNAPSHOT';exception when insufficient_privilege then null;end;
  execute format('set local role %I',owner_role);
  raise exception 'rollback H166 fixture' using errcode='ZX166';
 exception when sqlstate 'ZX166' then null; end;
 if (select revision from pos.online_snapshot_revision)<>baseline
   or exists(select 1 from auth.users where id=actor)
   or exists(select 1 from pos.settings where key=k) then raise exception 'H166_FIXTURE_LEAK'; end if;
end $verify$;
rollback;

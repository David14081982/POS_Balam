-- READ ONLY. Output includes private account/permission rollback evidence; never publish it.
begin isolation level repeatable read read only;
select jsonb_build_object(
'metadata',(select jsonb_build_object(
 'at',statement_timestamp(),
 'versions',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version>='20261107022800'),
 'functions',(select jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,
   'definition',replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),
   'hash',md5(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n')),
   'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef)
   order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='pos' and p.prokind='f'),
 'assignments',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,'' order by user_id),''))) from pos.user_permission_role_assignments t),
 'screen_overrides',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by user_id,screen_key),'')) from pos.user_screen_permission_overrides t),
 'capability_overrides',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by user_id,capability_key),'')) from pos.user_capability_overrides t),
 'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='pos'),
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'acl',c.relacl) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pos' and c.relkind='r'),
 'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgrelid::regclass::text,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='pos' and not t.tgisinternal)
)),
'census',(select jsonb_build_object(
 'at',statement_timestamp(),
 'capabilities',(select jsonb_agg(capability_key order by capability_key) from pos.operational_capabilities where active),
 'accounts',(select jsonb_agg(jsonb_build_object(
  'id',u.id,'name',coalesce(s.nombre,'Sin perfil'),'profile_role',s.role,
  'active',coalesce(s.active and s.deleted_at is null,false),'base_role',a.role_code,'assignment_active',a.active,
  'screens',(select coalesce(jsonb_agg(c.screen_key order by c.screen_key),'[]') from pos.screen_permission_catalog c
   cross join lateral pos.resolve_screen_permission(u.id,c.screen_key) r where c.active and c.is_leaf and r.allowed),
  'before',(select coalesce(jsonb_agg(c.capability_key order by c.capability_key),'[]') from pos.operational_capabilities c
   cross join lateral pos.resolve_operational_capability(u.id,c.capability_key) r where c.active and r.allowed)
 ) order by s.nombre,u.id) from auth.users u
 left join lateral(select p.* from pos.sellers p where lower(p.email)=lower(u.email)
  order by (p.deleted_at is null) desc,p.updated_at desc limit 1) s on true
 left join pos.user_permission_role_assignments a on a.user_id=u.id),
 'permission_fingerprint',md5(jsonb_build_array(
  (select jsonb_agg(to_jsonb(a) order by user_id) from pos.user_permission_role_assignments a),
  (select jsonb_agg(to_jsonb(a) order by user_id,screen_key) from pos.user_screen_permission_overrides a),
  (select jsonb_agg(to_jsonb(a) order by user_id,capability_key) from pos.user_capability_overrides a),
  (select jsonb_agg(to_jsonb(a) order by role_code,screen_key) from pos.role_screen_permissions a),
  (select jsonb_agg(to_jsonb(a) order by role_code,capability_key) from pos.role_capability_permissions a),
  (select jsonb_agg(jsonb_build_array(id,email) order by id) from auth.users),
  (select jsonb_agg(jsonb_build_array(id,email,role,active,deleted_at) order by id) from pos.sellers),
  (select jsonb_agg(to_jsonb(a) order by screen_key) from pos.screen_permission_catalog a),
  (select jsonb_agg(to_jsonb(a) order by code) from pos.permission_roles a)
 )::text)
)),
'permissions',jsonb_build_object(
'user_permission_role_assignments',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from pos.user_permission_role_assignments t),
'user_screen_permission_overrides',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from pos.user_screen_permission_overrides t),
'user_capability_overrides',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from pos.user_capability_overrides t),
'role_capability_permissions',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from pos.role_capability_permissions t),
'role_screen_permissions',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from pos.role_screen_permissions t),
'screen_permission_catalog',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from pos.screen_permission_catalog t),
'screen_permission_catalog_state',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from pos.screen_permission_catalog_state t),
'operational_capabilities',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from pos.operational_capabilities t),
'permission_roles',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from pos.permission_roles t)
),
'rows',(select jsonb_agg(to_jsonb(t) order by name) from (select 'barcode_aliases'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.barcode_aliases t
union all
select 'capability_operation_audit'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.capability_operation_audit t
union all
select 'clients'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.clients t
union all
select 'commission_adjustments'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.commission_adjustments t
union all
select 'config_commits'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.config_commits t
union all
select 'config_sync_state'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.config_sync_state t
union all
select 'exchange_commits'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.exchange_commits t
union all
select 'exchange_items'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.exchange_items t
union all
select 'exchanges'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.exchanges t
union all
select 'folio_counters'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.folio_counters t
union all
select 'inventory_contract_state'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.inventory_contract_state t
union all
select 'inventory_sync_baselines'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.inventory_sync_baselines t
union all
select 'inventory_v1_v2_map'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.inventory_v1_v2_map t
union all
select 'inventory_v3_backups'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.inventory_v3_backups t
union all
select 'inventory_v3_operations'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.inventory_v3_operations t
union all
select 'layaway_liquidation_commits'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.layaway_liquidation_commits t
union all
select 'liquidations'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.liquidations t
union all
select 'loan_documents'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.loan_documents t
union all
select 'lookup'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.lookup t
union all
select 'movements'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.movements t
union all
select 'online_account_requests'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.online_account_requests t
union all
select 'online_legacy_archives'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.online_legacy_archives t
union all
select 'online_legacy_operations'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.online_legacy_operations t
union all
select 'online_requests'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.online_requests t
union all
select 'online_runtime'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.online_runtime t
union all
select 'online_snapshot_revision'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.online_snapshot_revision t
union all
select 'operational_capabilities'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.operational_capabilities t
union all
select 'permission_change_audit'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.permission_change_audit t
union all
select 'permission_roles'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.permission_roles t
union all
select 'physical_card_redemptions'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.physical_card_redemptions t
union all
select 'point_zero_backups'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.point_zero_backups t
union all
select 'point_zero_operations'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.point_zero_operations t
union all
select 'products'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.products t
union all
select 'promotions'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.promotions t
union all
select 'purged_documents'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.purged_documents t
union all
select 'reference_reclassifications'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.reference_reclassifications t
union all
select 'return_commits'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.return_commits t
union all
select 'return_items'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.return_items t
union all
select 'returns'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.returns t
union all
select 'role_capability_permissions'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.role_capability_permissions t
union all
select 'role_screen_permissions'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.role_screen_permissions t
union all
select 'sale_commits'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.sale_commits t
union all
select 'sale_items'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.sale_items t
union all
select 'sale_payments'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.sale_payments t
union all
select 'sales'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.sales t
union all
select 'screen_permission_catalog'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.screen_permission_catalog t
union all
select 'screen_permission_catalog_state'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.screen_permission_catalog_state t
union all
select 'selective_cleanup_events'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.selective_cleanup_events t
union all
select 'sellers'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.sellers t
union all
select 'settings'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.settings t
union all
select 'stock_reservations'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.stock_reservations t
union all
select 'sync_activity'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.sync_activity t
union all
select 'sync_conflicts'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.sync_conflicts t
union all
select 'sync_device_recoveries'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.sync_device_recoveries t
union all
select 'sync_devices'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.sync_devices t
union all
select 'sync_domain_versions'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.sync_domain_versions t
union all
select 'sync_quarantine_cases'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.sync_quarantine_cases t
union all
select 'system_manifest'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.system_manifest t
union all
select 'test_data_cleanup_backups'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.test_data_cleanup_backups t
union all
select 'test_data_cleanup_operations'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.test_data_cleanup_operations t
union all
select 'test_data_purges'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.test_data_purges t
union all
select 'user_capability_overrides'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.user_capability_overrides t
union all
select 'user_permission_role_assignments'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.user_permission_role_assignments t
union all
select 'user_screen_permission_overrides'::text name,count(*) row_count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') hash from pos.user_screen_permission_overrides t) t),
'migrations',(select jsonb_agg(to_jsonb(m) order by version) from (select version,name,statements from supabase_migrations.schema_migrations where version>='20261107022800') m)
) evidence;
commit;

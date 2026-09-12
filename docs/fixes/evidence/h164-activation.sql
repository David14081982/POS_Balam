-- H164 controlled cutover; NOT an automatic migration. Run only after Pages
-- bytes and admin-users deployment are verified. Replace __PAGES_SHA256__ IN
-- MEMORY with the verified 64-character SHA256; a placeholder always fails.
-- If a NOWAIT lock fails, the entire transaction rolls back. Allow ordinary
-- requests to finish; never terminate them or bypass a validation to activate.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local application_name='balam-h164-cutover';
set local balam.pages_sha256='__PAGES_SHA256__';
do $precondition$ begin
 if current_setting('balam.pages_sha256',true) !~* '^[a-f0-9]{64}$' then raise exception 'H164_PAGES_HASH_NOT_VERIFIED'; end if;
 if not exists(select 1 from pos.online_runtime where singleton and not enabled and contract_version=1) then raise exception 'H164_ACTIVATION_STATE_CHANGED_USE_READONLY_VERIFICATION'; end if;
 if exists(select 1 from unnest(array['20260911020800','20260911020900','20260912021000','20260912021100']) v(version)
 where not exists(select 1 from supabase_migrations.schema_migrations m where m.version=v.version)) then raise exception 'H164_REQUIRED_MIGRATION_MISSING'; end if;
end $precondition$;
-- Lock all 63 pos tables, including receipts/devices read before the gateway
-- advisory lock. NOWAIT avoids a circular wait while holding a partial set.
lock table
 pos.barcode_aliases,
 pos.capability_operation_audit,
 pos.clients,
 pos.commission_adjustments,
 pos.config_commits,
 pos.config_sync_state,
 pos.exchange_commits,
 pos.exchange_items,
 pos.exchanges,
 pos.folio_counters,
 pos.inventory_contract_state,
 pos.inventory_sync_baselines,
 pos.inventory_v1_v2_map,
 pos.inventory_v3_backups,
 pos.inventory_v3_operations,
 pos.layaway_liquidation_commits,
 pos.liquidations,
 pos.loan_documents,
 pos.lookup,
 pos.movements,
 pos.online_account_requests,
 pos.online_legacy_archives,
 pos.online_legacy_operations,
 pos.online_requests,
 pos.online_runtime,
 pos.operational_capabilities,
 pos.permission_change_audit,
 pos.permission_roles,
 pos.physical_card_redemptions,
 pos.point_zero_backups,
 pos.point_zero_operations,
 pos.products,
 pos.promotions,
 pos.purged_documents,
 pos.reference_reclassifications,
 pos.return_commits,
 pos.return_items,
 pos.returns,
 pos.role_capability_permissions,
 pos.role_screen_permissions,
 pos.sale_commits,
 pos.sale_items,
 pos.sale_payments,
 pos.sales,
 pos.screen_permission_catalog,
 pos.screen_permission_catalog_state,
 pos.selective_cleanup_events,
 pos.sellers,
 pos.settings,
 pos.stock_reservations,
 pos.sync_activity,
 pos.sync_conflicts,
 pos.sync_device_recoveries,
 pos.sync_devices,
 pos.sync_domain_versions,
 pos.sync_quarantine_cases,
 pos.system_manifest,
 pos.test_data_cleanup_backups,
 pos.test_data_cleanup_operations,
 pos.test_data_purges,
 pos.user_capability_overrides,
 pos.user_permission_role_assignments,
 pos.user_screen_permission_overrides
 in access exclusive mode nowait;
do $drained$ begin
 if not pg_try_advisory_xact_lock(hashtextextended('pos.online.commercial',164)) then raise exception 'H164_COMMERCIAL_TRANSACTION_IN_PROGRESS'; end if;
end $drained$;
do $counts$
declare t text; n bigint; counts jsonb:='{}';
begin
 foreach t in array array['barcode_aliases','capability_operation_audit','clients','commission_adjustments','config_commits','config_sync_state','exchange_commits','exchange_items','exchanges','folio_counters','inventory_contract_state','inventory_sync_baselines','inventory_v1_v2_map','inventory_v3_backups','inventory_v3_operations','layaway_liquidation_commits','liquidations','loan_documents','lookup','movements','online_account_requests','online_legacy_archives','online_legacy_operations','online_requests','online_runtime','operational_capabilities','permission_change_audit','permission_roles','physical_card_redemptions','point_zero_backups','point_zero_operations','products','promotions','purged_documents','reference_reclassifications','return_commits','return_items','returns','role_capability_permissions','role_screen_permissions','sale_commits','sale_items','sale_payments','sales','screen_permission_catalog','screen_permission_catalog_state','selective_cleanup_events','sellers','settings','stock_reservations','sync_activity','sync_conflicts','sync_device_recoveries','sync_devices','sync_domain_versions','sync_quarantine_cases','system_manifest','test_data_cleanup_backups','test_data_cleanup_operations','test_data_purges','user_capability_overrides','user_permission_role_assignments','user_screen_permission_overrides'] loop
  execute format('select count(*) from pos.%I',t) into n; counts:=counts||jsonb_build_object(t,n);
 end loop;
 perform set_config('balam.activation_counts',counts::text,true);
end $counts$;
select pos.activate_online_only() as activation;
-- BEGIN SHARED READ-ONLY VERIFICATION
do $verify$
declare r record; n integer;
begin
 if exists(select 1 from unnest(array['20260911020800','20260911020900','20260912021000','20260912021100']) v(version)
 where not exists(select 1 from supabase_migrations.schema_migrations m where m.version=v.version)) then raise exception 'H164_REQUIRED_MIGRATION_MISSING'; end if;
 if not exists(select 1 from pos.online_runtime where singleton and enabled and contract_version=1 and activated_at is not null) then raise exception 'H164_ONLINE_NOT_ACTIVE'; end if;
 select count(*) into n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='pos' and c.relkind='r';
 if n<>63 then raise exception 'H164_TABLE_INVENTORY_DRIFT: %',n; end if;
 select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='pos';
 if n<>152 then raise exception 'H164_FUNCTION_INVENTORY_DRIFT: %',n; end if;
 if exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='pos' and p.proname=any(array['admin_decide_sync_quarantine','consume_sync_quarantine_decisions','consume_sync_commands','admin_mark_sync_activity_reviewed','admin_request_sync_retry','complete_sync_command','report_sync_device','complete_sync_quarantine','report_sync_quarantine','complete_sync_device_recovery','capture_sync_device_recovery','prepare_sync_device_recovery','get_sync_device_recovery','establish_sync_point_zero','commit_legacy_return','touch_sync_domain','touch_sync_devices_domain','h81_touch_quarantine_devices','h80_sync_activity_material_change'])) then raise exception 'H164_RETIRED_FUNCTION_REMAINS'; end if;
 if exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace ns on ns.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid
  where ns.nspname='pos' and not t.tgisinternal and p.proname=any(array['touch_sync_domain','touch_sync_devices_domain','h81_touch_quarantine_devices','h80_sync_activity_material_change'])) then raise exception 'H164_CURSOR_TRIGGER_REMAINS'; end if;
 for r in select c.oid,c.relname from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='pos' and c.relkind in('r','p') loop
  if has_table_privilege('authenticated',r.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_table_privilege('anon',r.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'H164_DIRECT_WRITE_GRANT: %',r.relname; end if;
 end loop;
 if exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclrole=(select relowner from pg_class where oid='pos.online_runtime'::regclass)
  and d.defaclobjtype='r' and d.defaclnamespace in(0,'pos'::regnamespace) and a.grantee in(0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'))
  and a.privilege_type in('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) then raise exception 'H164_DEFAULT_WRITE_GRANT_REMAINS'; end if;
 select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='pos' and p.proname=any(array['commit_reference_family_batch','reserve_sale_stock','execute_test_data_cleanup','create_test_data_cleanup_backup','delete_products_checked_v2','admin_set_sync_device_retired','claim_physical_card','commit_exchange_checked','commit_return_checked','h133_restore_inventory_v3_backup','soft_delete_entity','reserve_folio_block','admin_apply_user_screen_permissions','admin_apply_role_screen_permissions','commit_layaway_liquidation_checked','admin_sync_screen_permission_catalog','admin_apply_user_screen_permissions_checked','settle_commission_checked','close_commission_period_checked','commit_loan_operation','purge_test_data','apply_commission_adjustment_checked','commit_config','save_products_checked_v2','delete_product_checked_v2','admin_update_sync_device','execute_point_zero','commit_reference_reclassification','commit_sale_with_additional_discount_checked','commit_sale_checked','create_point_zero_backup']);
 if n<>31 then raise exception 'H164_FINANCIAL_HELPER_MISSING: %',n; end if;
 for r in select p.oid,p.proname,p.proacl,p.proowner from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='pos' and p.proname=any(array['commit_reference_family_batch','reserve_sale_stock','execute_test_data_cleanup','create_test_data_cleanup_backup','delete_products_checked_v2','admin_set_sync_device_retired','claim_physical_card','commit_exchange_checked','commit_return_checked','h133_restore_inventory_v3_backup','soft_delete_entity','reserve_folio_block','admin_apply_user_screen_permissions','admin_apply_role_screen_permissions','commit_layaway_liquidation_checked','admin_sync_screen_permission_catalog','admin_apply_user_screen_permissions_checked','settle_commission_checked','close_commission_period_checked','commit_loan_operation','purge_test_data','apply_commission_adjustment_checked','commit_config','save_products_checked_v2','delete_product_checked_v2','admin_update_sync_device','execute_point_zero','commit_reference_reclassification','commit_sale_with_additional_discount_checked','commit_sale_checked','create_point_zero_backup','online_request_context','assert_online_device','guard_online_commercial_write','online_check_rows','online_save_entities','dispatch_online_command','online_account_profile_command','online_legacy_intents','classify_online_legacy','prepare_online_account','advance_online_account','activate_online_only']) loop
  if has_function_privilege('authenticated',r.oid,'EXECUTE') or has_function_privilege('anon',r.oid,'EXECUTE') or exists(select 1 from aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'H164_LEGACY_OR_INTERNAL_RPC_EXPOSED: %',r.proname; end if;
 end loop;
 for r in select p.oid,p.proname,p.proacl,p.proowner from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='pos' and p.proname=any(array['execute_online_command','resolve_online_request','online_request_result','online_presence','online_connectivity','online_account_result','online_legacy_review_count','online_quote_context','online_commission_context','online_snapshot','archive_online_legacy']) loop
  if not has_function_privilege('authenticated',r.oid,'EXECUTE') or has_function_privilege('anon',r.oid,'EXECUTE') or exists(select 1 from aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'H164_ONLINE_ENDPOINT_GRANT: %',r.proname; end if;
 end loop;
 if exists(select 1 from unnest(array['online_request_context','assert_online_device','guard_online_commercial_write','online_check_rows','online_save_entities','dispatch_online_command','online_account_profile_command','online_legacy_intents','classify_online_legacy','prepare_online_account','advance_online_account','activate_online_only','execute_online_command','resolve_online_request','online_request_result','online_presence','online_connectivity','online_account_result','online_legacy_review_count','online_quote_context','online_commission_context','online_snapshot','archive_online_legacy']) v(name) where not exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='pos' and p.proname=v.name)) then raise exception 'H164_ONLINE_ENDPOINT_MISSING'; end if;
 if exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='pos' and p.proname in('prepare_online_account','advance_online_account','activate_online_only') and not has_function_privilege('service_role',p.oid,'EXECUTE')) then raise exception 'H164_SERVICE_ENDPOINT_GRANT'; end if;
 select count(*) into n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='pos' and t.tgname='h164_online_authority' and t.tgenabled='O' and t.tgfoid='pos.guard_online_commercial_write()'::regprocedure;
 if n<>35 then raise exception 'H164_AUTHORITY_FENCE_COUNT: %',n; end if;
 if exists(select 1 from unnest(array['products','clients','sellers','promotions','sales','sale_items','sale_payments','returns','return_items','exchanges','exchange_items','movements','loan_documents','liquidations','commission_adjustments','lookup','settings','stock_reservations','sale_commits','return_commits','exchange_commits','layaway_liquidation_commits','reference_reclassifications','physical_card_redemptions','folio_counters','config_commits','config_sync_state','screen_permission_catalog','screen_permission_catalog_state','user_permission_role_assignments','role_screen_permissions','user_screen_permission_overrides','user_capability_overrides','role_capability_permissions','permission_roles']) v(name) where not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='pos' and c.relname=v.name and t.tgname='h164_online_authority' and t.tgenabled='O' and t.tgfoid='pos.guard_online_commercial_write()'::regprocedure)) then raise exception 'H164_AUTHORITY_FENCE_MISSING'; end if;
 if (select prosecdef from pg_proc where oid='pos.online_snapshot()'::regprocedure) then raise exception 'H164_SNAPSHOT_RLS_CHANGED'; end if;
 for r in select c.oid,c.relname,c.relrowsecurity from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='pos' and c.relname in('online_requests','online_legacy_archives','online_legacy_operations','online_account_requests') loop
  if not r.relrowsecurity or has_table_privilege('authenticated',r.oid,'SELECT') or has_table_privilege('anon',r.oid,'SELECT') then raise exception 'H164_TECHNICAL_EVIDENCE_EXPOSED: %',r.relname; end if;
 end loop;
 if position('recovery_row.state in(''captured'',''completed'') and recovery_row.discarded_ids' in pg_get_functiondef('pos.assert_device_recovery_write(text,text[])'::regprocedure))=0 or position('r.state in(''captured'',''completed'') and (oid=any(r.discarded_ids)' in pg_get_functiondef('pos.classify_online_legacy(text,jsonb)'::regprocedure))=0 or position('r.state in(''captured'',''completed'') and oid=any(r.discarded_ids)' in pg_get_functiondef('pos.archive_online_legacy(text,jsonb)'::regprocedure))=0 then raise exception 'H164_DISCARD_SCOPE_REGRESSED'; end if;
 if exists(select 1 from pos.online_requests where state='executing') then raise exception 'H164_NONTERMINAL_SERVER_RECEIPT'; end if;
end $verify$;
-- END SHARED READ-ONLY VERIFICATION

do $preserved$
declare t text; n bigint; before_counts jsonb:=current_setting('balam.activation_counts')::jsonb;
begin
 foreach t in array array['barcode_aliases','capability_operation_audit','clients','commission_adjustments','config_commits','config_sync_state','exchange_commits','exchange_items','exchanges','folio_counters','inventory_contract_state','inventory_sync_baselines','inventory_v1_v2_map','inventory_v3_backups','inventory_v3_operations','layaway_liquidation_commits','liquidations','loan_documents','lookup','movements','online_account_requests','online_legacy_archives','online_legacy_operations','online_requests','online_runtime','operational_capabilities','permission_change_audit','permission_roles','physical_card_redemptions','point_zero_backups','point_zero_operations','products','promotions','purged_documents','reference_reclassifications','return_commits','return_items','returns','role_capability_permissions','role_screen_permissions','sale_commits','sale_items','sale_payments','sales','screen_permission_catalog','screen_permission_catalog_state','selective_cleanup_events','sellers','settings','stock_reservations','sync_activity','sync_conflicts','sync_device_recoveries','sync_devices','sync_domain_versions','sync_quarantine_cases','system_manifest','test_data_cleanup_backups','test_data_cleanup_operations','test_data_purges','user_capability_overrides','user_permission_role_assignments','user_screen_permission_overrides'] loop
  execute format('select count(*) from pos.%I',t) into n;
  if n is distinct from (before_counts->>t)::bigint then raise exception 'H164_ACTIVATION_ROW_COUNT_CHANGED: %',t; end if;
 end loop;
end $preserved$;
commit;
select jsonb_build_object('ok',true,'onlineOnly',r.enabled,'contractVersion',r.contract_version,'activatedAt',r.activated_at,'posTables',63,'posFunctions',152,'retiredFunctions',19,'retiredCursorTriggers',26,'legacyRpcBrowserGrants',0,'directWriteGrants',0,'gatewayFences',35,
 'legacyEvidenceSources',(select count(*) from pos.online_legacy_archives),'legacyOperationsNeedingReview',(select count(*) from pos.online_legacy_operations where classification='needs_review'),
 'unknownLegacySourcesNeedingReview',(select count(*) from pos.online_legacy_archives a where a.classification='needs_review' and not exists(select 1 from pos.online_legacy_intents(a.original))),
 'accountRequestsNeedingConfirmation',(select count(*) from pos.online_account_requests where state not in('completed','rejected','cancelled')),'serverTime',clock_timestamp()) as activation_verification from pos.online_runtime r where singleton;

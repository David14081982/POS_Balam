-- H171: independent read-only verification after the rejected exact cleanup.
BEGIN READ ONLY;
SET LOCAL statement_timeout='45s';
SET LOCAL TimeZone='UTC';
SET LOCAL DateStyle='ISO, MDY';
WITH expected AS (SELECT * FROM jsonb_to_recordset($h171_rollback_expected$[{"table_name":"clients","row_count":19,"full_rows_md5":"084b63281b5eb9f06fd14446a6a4c4fb"},{"table_name":"commission_adjustments","row_count":0,"full_rows_md5":"d41d8cd98f00b204e9800998ecf8427e"},{"table_name":"config_commits","row_count":66,"full_rows_md5":"c7d983f24c0230ee8da93fe5d5bcf2f6"},{"table_name":"config_sync_state","row_count":1,"full_rows_md5":"e0ad5eb807237196efb419368dad86fc"},{"table_name":"exchange_commits","row_count":2,"full_rows_md5":"5372ccee46a6f1923da66346c0bfcf0d"},{"table_name":"exchange_items","row_count":4,"full_rows_md5":"00369ee53c1f874afb6ece36f7647f02"},{"table_name":"exchanges","row_count":2,"full_rows_md5":"37b8da98b4a1795f3be2d931fde354fc"},{"table_name":"folio_counters","row_count":3,"full_rows_md5":"b4639e121d23f951d9db30eb9642fe32"},{"table_name":"layaway_liquidation_commits","row_count":2,"full_rows_md5":"656f683d69a9df168e56f163aff7a9df"},{"table_name":"liquidations","row_count":2,"full_rows_md5":"54810d8d2595be65f17927087159d847"},{"table_name":"loan_documents","row_count":2,"full_rows_md5":"298169159e19bf796352f00458c089dc"},{"table_name":"lookup","row_count":552,"full_rows_md5":"cd57be24c198f56cf83c35617b3db299"},{"table_name":"movements","row_count":18,"full_rows_md5":"20177d1edcec49e8f2ccc1f1c5469d0b"},{"table_name":"permission_roles","row_count":2,"full_rows_md5":"839b7ebb616d253e6f3f06129c694759"},{"table_name":"physical_card_redemptions","row_count":0,"full_rows_md5":"d41d8cd98f00b204e9800998ecf8427e"},{"table_name":"products","row_count":987,"full_rows_md5":"53d361aed4f026c8ff53487964061599"},{"table_name":"promotions","row_count":8,"full_rows_md5":"d5c8017c06b9501b5e137536fac7f6f2"},{"table_name":"reference_reclassifications","row_count":2,"full_rows_md5":"63d518710bb33cbc4c750fd21618a11f"},{"table_name":"return_commits","row_count":2,"full_rows_md5":"2154b45dac22a78fbd882bd4fbd7d62b"},{"table_name":"return_items","row_count":2,"full_rows_md5":"b7dd92abb568dbf92a724e94bfaa478b"},{"table_name":"returns","row_count":2,"full_rows_md5":"518f336c05ec7937a06ac49f07adf973"},{"table_name":"role_capability_permissions","row_count":31,"full_rows_md5":"f4e0c82e264ad5513068c9c69c532aff"},{"table_name":"role_screen_permissions","row_count":44,"full_rows_md5":"4e4e18a9a74a2e8ec41631a40b475ed1"},{"table_name":"sale_commits","row_count":12,"full_rows_md5":"2c9ad918a7d6e8ca5b03c426380319d0"},{"table_name":"sale_items","row_count":8,"full_rows_md5":"52033868eedd3c69e54b2ff11af1d200"},{"table_name":"sale_payments","row_count":14,"full_rows_md5":"98e50b9ebc41b7eaef296fc6038e629f"},{"table_name":"sales","row_count":8,"full_rows_md5":"b31c17adc57a7e6ad22704752153d21d"},{"table_name":"screen_permission_catalog","row_count":22,"full_rows_md5":"738869ef1e1002dcad7e9e05089b0b3d"},{"table_name":"screen_permission_catalog_state","row_count":1,"full_rows_md5":"08625ca802d4e29bf98d35d1cd3eeda5"},{"table_name":"sellers","row_count":32,"full_rows_md5":"3ee940d4aaf592c809230dd980a19561"},{"table_name":"settings","row_count":46,"full_rows_md5":"4a2952ac06e6bcb58309d0f780eff612"},{"table_name":"stock_reservations","row_count":8,"full_rows_md5":"1a1be5e83fe5e8253e28a0382b1dc7ae"},{"table_name":"user_capability_overrides","row_count":0,"full_rows_md5":"d41d8cd98f00b204e9800998ecf8427e"},{"table_name":"user_permission_role_assignments","row_count":9,"full_rows_md5":"b11ad3c9e2759175efb5f519f1484d08"},{"table_name":"user_screen_permission_overrides","row_count":27,"full_rows_md5":"a5c06d1f59a452cd195fc627777728a5"}]$h171_rollback_expected$::jsonb) AS e(table_name text,row_count bigint,full_rows_md5 text)),actual AS (SELECT 'clients' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.clients t
UNION ALL
SELECT 'commission_adjustments' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.commission_adjustments t
UNION ALL
SELECT 'config_commits' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.config_commits t
UNION ALL
SELECT 'config_sync_state' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.config_sync_state t
UNION ALL
SELECT 'exchange_commits' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.exchange_commits t
UNION ALL
SELECT 'exchange_items' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.exchange_items t
UNION ALL
SELECT 'exchanges' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.exchanges t
UNION ALL
SELECT 'folio_counters' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.folio_counters t
UNION ALL
SELECT 'layaway_liquidation_commits' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.layaway_liquidation_commits t
UNION ALL
SELECT 'liquidations' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.liquidations t
UNION ALL
SELECT 'loan_documents' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.loan_documents t
UNION ALL
SELECT 'lookup' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.lookup t
UNION ALL
SELECT 'movements' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.movements t
UNION ALL
SELECT 'permission_roles' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.permission_roles t
UNION ALL
SELECT 'physical_card_redemptions' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.physical_card_redemptions t
UNION ALL
SELECT 'products' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.products t
UNION ALL
SELECT 'promotions' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.promotions t
UNION ALL
SELECT 'reference_reclassifications' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.reference_reclassifications t
UNION ALL
SELECT 'return_commits' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.return_commits t
UNION ALL
SELECT 'return_items' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.return_items t
UNION ALL
SELECT 'returns' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.returns t
UNION ALL
SELECT 'role_capability_permissions' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.role_capability_permissions t
UNION ALL
SELECT 'role_screen_permissions' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.role_screen_permissions t
UNION ALL
SELECT 'sale_commits' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.sale_commits t
UNION ALL
SELECT 'sale_items' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.sale_items t
UNION ALL
SELECT 'sale_payments' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.sale_payments t
UNION ALL
SELECT 'sales' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.sales t
UNION ALL
SELECT 'screen_permission_catalog' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.screen_permission_catalog t
UNION ALL
SELECT 'screen_permission_catalog_state' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.screen_permission_catalog_state t
UNION ALL
SELECT 'sellers' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.sellers t
UNION ALL
SELECT 'settings' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.settings t
UNION ALL
SELECT 'stock_reservations' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.stock_reservations t
UNION ALL
SELECT 'user_capability_overrides' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.user_capability_overrides t
UNION ALL
SELECT 'user_permission_role_assignments' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.user_permission_role_assignments t
UNION ALL
SELECT 'user_screen_permission_overrides' AS table_name,count(*) AS row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS full_rows_md5 FROM pos.user_screen_permission_overrides t),checks AS(SELECT e.table_name,e.row_count AS expected_rows,a.row_count AS actual_rows,e.full_rows_md5 AS expected_md5,a.full_rows_md5 AS actual_md5 FROM expected e JOIN actual a USING(table_name))
SELECT jsonb_build_object('audit','H171 commercial rollback all original tables','at',clock_timestamp(),'project_ref','telohdbvbvsfmwyriflz','read_only',current_setting('transaction_read_only'),'expected_tables',35,'checked_tables',(SELECT count(*) FROM checks),'unchanged_tables',(SELECT count(*) FROM checks WHERE expected_rows=actual_rows AND expected_md5=actual_md5),'failures',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM checks c WHERE expected_rows IS DISTINCT FROM actual_rows OR expected_md5 IS DISTINCT FROM actual_md5),'table_checks',(SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name) FROM checks c),'current_inventory',(SELECT jsonb_build_object('all_rows',count(*),'active_rows',count(*) FILTER(WHERE deleted_at IS NULL),'active_families',count(DISTINCT reference_family_id) FILTER(WHERE deleted_at IS NULL),'active_v2_pieces',sum(stock_quantity) FILTER(WHERE deleted_at IS NULL AND record_model='v2')) FROM pos.products),'snapshot_revision',(SELECT revision FROM pos.online_snapshot_revision WHERE singleton)) AS report;
COMMIT;

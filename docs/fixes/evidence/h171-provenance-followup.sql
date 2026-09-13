-- H171 follow-up of the 2026-09-13 02:08 UTC read-only census.
-- ONLY READS. No cleanup, no account changes, no function calls with side effects.
-- Marker-only provenance stays UNKNOWN. Follow IDs/actor/receipt, never names.
-- HISTORICAL QUERY LIMITATIONS discovered after its saved execution:
-- protected_run is user-editable raw_user_meta_data, not protected app metadata.
-- same_run_confirmed_operation can match JSON null when operation_id is NULL;
-- use the subsequent exact cleanup dry-run for validated movement relationships.
-- Its original FK diagnostic conclusion was invalid (XPath/tableforest mismatch);
-- direct Auth FK counts and h171-cleanup-approval-plan.md supersede that conclusion.
BEGIN READ ONLY;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
WITH scope AS (SELECT $h171_scope$
{"candidates":[{"classification":"UNKNOWN_MARKER_ONLY","row_id":"cli-1789078624431-0fz3","row_md5":"637e3a14e34965b2120defb11c6b6b19","table_name":"clients"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"cli-1789078938103-ams0","row_md5":"48cf67c3064e7f31b5b5497ff0082bfd","table_name":"clients"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"cli-1789079431176-jyxi","row_md5":"bf6c133205988d9829d322a6995d7eb3","table_name":"clients"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"cli-4ac858d0-d18f-4533-9b6b-7bfedaa93260","row_md5":"e03877e9ce5810072b2b74ea2109b027","table_name":"clients"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"cli-9d26e399-dcb8-4ff9-b58d-07c1e932c503","row_md5":"af54e4d3906f0013656337ea0d5295e5","table_name":"clients"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"promo-1685ad28-6335-431f-a304-fed01fe182b8","row_md5":"c050f9a775cffbeb0b6f2697647af11b","table_name":"promotions"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"promo-1789079431430","row_md5":"acec5f446ea07ea168f126f7d2baebf2","table_name":"promotions"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"promo-998948b0-a310-4c02-9491-cfec813f42a1","row_md5":"ed7d2333a2b7a93b3e2f442c201daf23","table_name":"promotions"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"6dd83591-9e6b-482f-95e0-78470766cbce","row_md5":"d99b1882da596e1d8fb9f63aaab96ef4","table_name":"sellers"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"7e869e19-be08-40fb-96e0-7e444795e8fa","row_md5":"05e25b7258c4d078ab90d78972f67665","table_name":"sellers"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c-admin","row_md5":"f3e6b4ffadf83b5592c8e3ed2bf5a49d","table_name":"sellers"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c-seller","row_md5":"d87dd99e19882795dae3c7f672bd9fab","table_name":"sellers"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"qa-h164-69237da3-b20c-4a37-93fb-831fd846d867-admin","row_md5":"0120b300e3417015cba4bcd4c33d7bb4","table_name":"sellers"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"qa-h164-69237da3-b20c-4a37-93fb-831fd846d867-seller-A","row_md5":"1728a172d86a46bb7d975fa2d2622715","table_name":"sellers"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"qa-h164-69237da3-b20c-4a37-93fb-831fd846d867-seller-B","row_md5":"582a41e00a6a1e93ed9b5a6e1ce2af75","table_name":"sellers"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"qa-h164-69237da3-b20c-4a37-93fb-831fd846d867-seller-C","row_md5":"8fae79cf35cb16348168005ff92d44f4","table_name":"sellers"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"qa-h164-6d340d65-7e61-486e-9a2f-f189a57bf7ec-admin","row_md5":"88aedcf906817665e6a34b79df959177","table_name":"sellers"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"qa-h164-6d340d65-7e61-486e-9a2f-f189a57bf7ec-seller-A","row_md5":"46f8a64aba4dc8c4fc961ed353c24620","table_name":"sellers"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"qa-h164-6d340d65-7e61-486e-9a2f-f189a57bf7ec-seller-B","row_md5":"26bd23226ae3aca02890d64847173839","table_name":"sellers"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"qa-h164-6d340d65-7e61-486e-9a2f-f189a57bf7ec-seller-C","row_md5":"6a1b6cfd838e2f8e9e2664f343efec18","table_name":"sellers"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c","row_md5":"7e25dca923994c69d4198d24c34a6ac2","table_name":"settings"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"qa.h164.69237da3-b20c-4a37-93fb-831fd846d867","row_md5":"b9e564d50700946c8f7bbc20b2850398","table_name":"settings"},{"classification":"UNKNOWN_MARKER_ONLY","row_id":"qa.h164.6d340d65-7e61-486e-9a2f-f189a57bf7ec","row_md5":"741c1744f94a8aee8be0bb88e5370b67","table_name":"settings"}],"exactProducts":[{"run":"2607cae4-404d-48bc-bdfc-6381b9c4a173","id":"07e7f317-807e-4382-abd3-517f2f109484","row_md5":"84f31ab70b161ea3b90f9de487e837fe"},{"run":"2607cae4-404d-48bc-bdfc-6381b9c4a173","id":"0abfa7f5-6d8c-4edf-bfc8-0a7e87b0df03","row_md5":"d107841faadf6199896ef330393b18dd"},{"run":"2607cae4-404d-48bc-bdfc-6381b9c4a173","id":"1c329b33-1478-4316-83b2-0c96b73d386f","row_md5":"44f89d1e9bf0018c87f7c3ee64103a8c"},{"run":"2607cae4-404d-48bc-bdfc-6381b9c4a173","id":"49d6e6ba-3054-48e3-942d-fd2c6a5678cb","row_md5":"69f6fb3d35fbdcf54564774214ae74e3"},{"run":"2607cae4-404d-48bc-bdfc-6381b9c4a173","id":"6cf88a71-9c31-42f1-a446-cc4e27b8ac29","row_md5":"4f608ab20dddbc16279c5bb7c514792f"},{"run":"2607cae4-404d-48bc-bdfc-6381b9c4a173","id":"82b8863c-89dd-47be-8b4b-e81c66e202e3","row_md5":"5ee1c416946ac18ad06f64c7df2d8e38"},{"run":"2607cae4-404d-48bc-bdfc-6381b9c4a173","id":"cf187ffb-b033-4c09-a669-8f5a8fdf84fb","row_md5":"16b346f79f83e80b2cfa25f786c9a7f9"},{"run":"8a89fd93-552a-489d-ae6b-e0afabf899e7","id":"0fca850b-087c-481c-ac05-17e9e058bb7c","row_md5":"eff64db4a3f35bd65ffda4c0effe5ffb"},{"run":"8a89fd93-552a-489d-ae6b-e0afabf899e7","id":"3804757b-5bda-404b-8c39-f215b21f2d43","row_md5":"565eca62b6b23086b9562e68a1bceeeb"},{"run":"8a89fd93-552a-489d-ae6b-e0afabf899e7","id":"6a6375de-ecbf-4824-a062-907c838c36e4","row_md5":"48d53b653893e48b9a752fa5089b4ce4"},{"run":"8a89fd93-552a-489d-ae6b-e0afabf899e7","id":"81e59ebd-fa9d-41f7-81ee-af0a722b9fab","row_md5":"b13320a8fac1f8ae07e8a05540e7b71b"},{"run":"8a89fd93-552a-489d-ae6b-e0afabf899e7","id":"a7e2bc67-2f72-4e1f-90b2-e72acb8fd7be","row_md5":"453ebce903e6a8e4861a2ce1d44da431"},{"run":"8a89fd93-552a-489d-ae6b-e0afabf899e7","id":"c5a3b49d-f94c-423b-84e1-d02a8d97c4c0","row_md5":"f51e16c051dd17f7b186de76c18b1977"},{"run":"8a89fd93-552a-489d-ae6b-e0afabf899e7","id":"eb82cb4c-16c3-4c3c-9662-06323693df84","row_md5":"4777b5d07f25c477303a9505a6c172f2"}],"sales":[{"run":"2607cae4-404d-48bc-bdfc-6381b9c4a173","folio":"BG-260912-0002","operation_id":"55dc5ef6-9300-4b20-bae8-5ff9d9e9738d","client_id":"cli-09c8e0ba-c818-472c-af7b-0bdc399dfcd8"},{"run":"2607cae4-404d-48bc-bdfc-6381b9c4a173","folio":"BG-260912-0004","operation_id":"bc088419-d9c5-45c7-b7de-063b70e230bd","client_id":"cli-09c8e0ba-c818-472c-af7b-0bdc399dfcd8"},{"run":"2607cae4-404d-48bc-bdfc-6381b9c4a173","folio":"BG-260912-0007","operation_id":"d50de195-573a-49b3-9e7a-0cf94bf1a4c6","client_id":"cli-09c8e0ba-c818-472c-af7b-0bdc399dfcd8"},{"run":"8a89fd93-552a-489d-ae6b-e0afabf899e7","folio":"BG-260912-0008","operation_id":"3cb959ec-ca9f-4e52-b83e-6d829171634e","client_id":"cli-c6c85a94-12c3-4ec6-9bc9-7fdc0477ef8a"},{"run":"8a89fd93-552a-489d-ae6b-e0afabf899e7","folio":"BG-260912-0009","operation_id":"c652df23-8a36-45da-9287-91af1647c94b","client_id":"cli-c6c85a94-12c3-4ec6-9bc9-7fdc0477ef8a"},{"run":"8a89fd93-552a-489d-ae6b-e0afabf899e7","folio":"BG-260912-0010","operation_id":"b857ae81-cb1c-41ed-b630-3f4efebe3789","client_id":"cli-c6c85a94-12c3-4ec6-9bc9-7fdc0477ef8a"},{"run":"8a89fd93-552a-489d-ae6b-e0afabf899e7","folio":"BG-260912-0014","operation_id":"2bb786c0-3251-4048-871d-b0814ad6289a","client_id":"cli-c6c85a94-12c3-4ec6-9bc9-7fdc0477ef8a"}],"auth":[{"id":"0c854997-d4cb-4f5a-bf19-6640498c8219","run":null,"accountRequest":"2e5f432d-17ec-4b5a-a536-d2eb93cc188d","exact":true},{"id":"272aed8a-fab0-48e0-b2ba-e65d3f0884b9","run":"8a89fd93-552a-489d-ae6b-e0afabf899e7","accountRequest":null,"exact":true},{"id":"54633260-578a-4228-b7d1-4e36e6c49144","run":null,"accountRequest":null,"exact":false},{"id":"5d4ea7ba-d175-4b3a-8170-e84f0a8448d4","run":"69237da3-b20c-4a37-93fb-831fd846d867","accountRequest":null,"exact":false},{"id":"6dd83591-9e6b-482f-95e0-78470766cbce","run":null,"accountRequest":"80b27303-5134-4558-b9e9-046ff72100dd","exact":false},{"id":"720db98c-e653-4d86-8d5e-eab00a315959","run":null,"accountRequest":"1c776a20-2d34-44c9-92aa-af8058be9ac8","exact":true},{"id":"7e869e19-be08-40fb-96e0-7e444795e8fa","run":null,"accountRequest":"2be244a6-e951-4170-91dd-66fc12a0dcd5","exact":false},{"id":"85fd870d-1d81-484b-84d3-de60cd2576ec","run":null,"accountRequest":"d69b9b5d-60d8-492c-a0eb-55dba58887f1","exact":true},{"id":"895b586d-15b7-40ae-8ce1-926492c2a229","run":"ca80e903-4239-4fde-9a98-a93d163a5190","accountRequest":null,"exact":true},{"id":"eb46cc84-1fe2-4da0-84b6-8332a7ff3bad","run":"2607cae4-404d-48bc-bdfc-6381b9c4a173","accountRequest":null,"exact":true},{"id":"fb16c0b5-d9eb-4444-997c-c8e0c49f234b","run":"6d340d65-7e61-486e-9a2f-f189a57bf7ec","accountRequest":null,"exact":false}]}
$h171_scope$::jsonb AS j),
known_products AS (SELECT x->>'id' AS id,x->>'run' AS run FROM scope,jsonb_array_elements(j->'exactProducts') x),
known_sales AS (SELECT x->>'folio' AS folio,x->>'run' AS run,x->>'operation_id' AS operation_id,
 x->>'client_id' AS client_id FROM scope,jsonb_array_elements(j->'sales') x),
qa_users AS (
 SELECT u.id,u.raw_user_meta_data->>'balam_online_test' AS protected_run,
  u.raw_app_meta_data->>'balam_account_request_id' AS protected_account_request,
  substring(coalesce(u.email,'') FROM 'qa-h(?:164|148)-([0-9a-f-]{36})') AS email_run_candidate
 FROM auth.users u WHERE EXISTS(SELECT 1 FROM scope,jsonb_array_elements(j->'auth') a WHERE a->>'id'=u.id::text)
),
new_actors AS (
 SELECT * FROM qa_users WHERE protected_run IN('69237da3-b20c-4a37-93fb-831fd846d867','6d340d65-7e61-486e-9a2f-f189a57bf7ec')
),
candidates AS (SELECT x FROM scope,jsonb_array_elements(j->'candidates') x),
candidate_rows AS (
 SELECT c.x->>'table_name' AS table_name,c.x->>'row_id' AS id,to_jsonb(t) AS j FROM candidates c JOIN pos.clients t ON c.x->>'table_name'='clients' AND c.x->>'row_id'=t.id
 UNION ALL SELECT c.x->>'table_name',c.x->>'row_id',to_jsonb(t) FROM candidates c JOIN pos.promotions t ON c.x->>'table_name'='promotions' AND c.x->>'row_id'=t.id
 UNION ALL SELECT c.x->>'table_name',c.x->>'row_id',to_jsonb(t) FROM candidates c JOIN pos.sellers t ON c.x->>'table_name'='sellers' AND c.x->>'row_id'=t.id
 UNION ALL SELECT c.x->>'table_name',c.x->>'row_id',to_jsonb(t) FROM candidates c JOIN pos.settings t ON c.x->>'table_name'='settings' AND c.x->>'row_id'=t.key
),
storage_sources AS MATERIALIZED (
 SELECT 'products'::text AS source,id::text AS source_id,to_jsonb(p)::text AS body FROM pos.products p
 UNION ALL SELECT 'sellers',id,to_jsonb(s)::text FROM pos.sellers s
 UNION ALL SELECT 'settings',key,to_jsonb(s)::text FROM pos.settings s
 UNION ALL SELECT 'sales',folio,to_jsonb(s.receipt_snapshot)::text FROM pos.sales s
 UNION ALL SELECT 'returns',id,to_jsonb(r)::text FROM pos.returns r
 UNION ALL SELECT 'exchanges',id,to_jsonb(e)::text FROM pos.exchanges e
 UNION ALL SELECT 'loans',id::text,to_jsonb(l.document)::text FROM pos.loan_documents l
),
storage_summary AS (
 SELECT o.bucket_id,coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner') AS owner_id,
  substring(o.name FROM '^([^/]+)/') AS first_path_component,
  count(*) AS objects,min(o.created_at) AS first_created,max(o.created_at) AS last_created,
  count(*) FILTER(WHERE EXISTS(SELECT 1 FROM storage_sources s
   WHERE position(o.bucket_id||'/'||o.name IN s.body)>0 OR position(replace(o.bucket_id||'/'||o.name,' ','%20') IN s.body)>0)) AS url_suffix_referenced,
  count(*) FILTER(WHERE EXISTS(SELECT 1 FROM known_products p WHERE position(p.id IN o.name)>0)) AS known_qa_id_in_path,
  md5(string_agg(md5(to_jsonb(o)::text),'' ORDER BY o.id)) AS metadata_rows_md5
 FROM storage.objects o WHERE o.bucket_id IN('barcodes','product-photos')
 GROUP BY o.bucket_id,coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner'),substring(o.name FROM '^([^/]+)/')
),
movement_evidence AS (
 SELECT m.id,m.product_id,m.operation_id,m.return_id,k.run,
  m.tipo,m.cant,md5(coalesce(m.ref,'')) AS ref_md5,
  substring(m.ref FROM '(BG-[0-9]{6}-[0-9]+)') AS parsed_sale_folio,
  substring(m.ref FROM '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') AS parsed_reference_uuid,
  EXISTS(SELECT 1 FROM known_sales s WHERE s.run=k.run AND (s.folio=m.ref OR s.folio=substring(m.ref FROM '(BG-[0-9]{6}-[0-9]+)'))) AS exact_qa_sale_ref,
  EXISTS(SELECT 1 FROM pos.online_requests r JOIN qa_users q ON q.id=r.actor_id
   WHERE q.protected_run=k.run AND r.state='confirmed'
   AND (r.request_id::text=m.operation_id OR jsonb_path_exists(r.response,'$.**.operation_id ? (@ == $id)',jsonb_build_object('id',m.operation_id)))) AS same_run_confirmed_operation,
  md5(to_jsonb(m)::text) AS row_md5
 FROM pos.movements m JOIN known_products k ON k.id=m.product_id
),
loan_references AS (
 SELECT l.id,l.state,
  (SELECT coalesce(jsonb_agg(DISTINCT v),'[]'::jsonb) FROM jsonb_path_query(l.document,'$.**.productId') v) AS product_ids,
  md5(to_jsonb(l)::text) AS row_md5 FROM pos.loan_documents l
)
SELECT jsonb_build_object(
 'audit','H171 provenance and physical-reference follow-up','expected_project_ref','telohdbvbvsfmwyriflz',
 'generated_at',clock_timestamp(),'read_only',current_setting('transaction_read_only'),
 'candidate_provenance',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'table',c.table_name,'id',c.id,'row_md5',md5(c.j::text),'deleted_at',c.j->>'deleted_at','active',c.j->'active',
   'qa_run_in_marker',substring(concat_ws(' ',c.id,c.j->>'nombre',c.j->>'modelo') FROM 'qa[-.]h(?:164|148)[-.]([0-9a-f-]{36})'),
   'created_at',coalesce(c.j->>'created_at',c.j->>'creado'),'updated_at',c.j->>'updated_at',
   'exact_online_receipts',(SELECT coalesce(jsonb_agg(jsonb_build_object('actor_id',r.actor_id,'request_id',r.request_id,
    'protected_run',q.protected_run,'command_kind',r.command_kind,'state',r.state)),'[]'::jsonb)
    FROM pos.online_requests r JOIN qa_users q ON q.id=r.actor_id
    WHERE r.state='confirmed' AND jsonb_path_exists(r.response,'$.** ? (@ == $id)',jsonb_build_object('id',c.id))),
   'classification','UNKNOWN_UNTIL_RECEIPT_AND_SCOPE_REVIEW'
  ) ORDER BY c.table_name,c.id),'[]'::jsonb) FROM candidate_rows c),
 'additional_run_receipts',(SELECT coalesce(jsonb_agg(jsonb_build_object('run',a.protected_run,
   'actor_id',r.actor_id,'request_id',r.request_id,'kind',r.command_kind,'state',r.state,
   'created_at',r.created_at,'response_md5',md5(r.response::text),
   'ids',jsonb_path_query_array(r.response,'$.**.id'),
   'product_ids',jsonb_path_query_array(r.response,'$.**.product_id'),
   'folios',jsonb_path_query_array(r.response,'$.**.folio'),
   'client_ids',jsonb_path_query_array(r.response,'$.**.cliente_id'),
   'operation_ids',jsonb_path_query_array(r.response,'$.**.operation_id'))
   ORDER BY r.created_at),'[]'::jsonb) FROM pos.online_requests r JOIN new_actors a ON a.id=r.actor_id),
 'additional_account_receipts',(SELECT coalesce(jsonb_agg(jsonb_build_object('actor_id',r.actor_id,
   'request_id',r.request_id,'target_user_id',r.target_user_id,'action',r.action,'state',r.state,
   'run',a.protected_run,'created_at',r.created_at,'payload_hash',r.payload_hash,
   'auth_marker_matches',EXISTS(SELECT 1 FROM auth.users u WHERE u.id=r.target_user_id
     AND u.raw_app_meta_data->>'balam_account_request_id'=r.request_id::text))),'[]'::jsonb)
   FROM pos.online_account_requests r JOIN new_actors a ON a.id=r.actor_id),
 'remaining_auth_candidate',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,
   'protected_run',q.protected_run,'protected_account_request',q.protected_account_request,
   'email_run_candidate',q.email_run_candidate,
   'has_active_profile',EXISTS(SELECT 1 FROM pos.sellers s WHERE s.email=u.email AND s.active AND s.deleted_at IS NULL),
   'direct_profile_id',EXISTS(SELECT 1 FROM pos.sellers s WHERE s.id=u.id::text),
   'identities', (SELECT count(*) FROM auth.identities i WHERE i.user_id=u.id),
   'created_at',u.created_at,'last_sign_in_at',u.last_sign_in_at,'banned_until',u.banned_until,
   'classification','UNKNOWN_NOT_AUTHORIZED_FOR_DELETION')),'[]'::jsonb)
   FROM qa_users q JOIN auth.users u ON u.id=q.id WHERE q.protected_run IS NULL AND q.protected_account_request IS NULL),
 'movements',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]'::jsonb) FROM movement_evidence m),
 'reclassifications',(SELECT coalesce(jsonb_agg(jsonb_build_object('operation_id',r.operation_id,
   'source_product_id',r.source_product_id,'target_product_id',r.target_product_id,
   'both_ids_known_same_run',EXISTS(SELECT 1 FROM known_products a JOIN known_products b ON a.run=b.run
    WHERE a.id=r.source_product_id AND b.id=r.target_product_id),
   'row_md5',md5(to_jsonb(r)::text))),'[]'::jsonb) FROM pos.reference_reclassifications r),
 'loan_references',(SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) FROM loan_references l),
 'payments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'folio',p.folio,'tipo',p.tipo,
   'row_md5',md5(to_jsonb(p)::text),'validated_qa_sale',EXISTS(SELECT 1 FROM known_sales s WHERE s.folio=p.folio),
   'qa_exchange_same_folio',EXISTS(SELECT 1 FROM pos.exchanges e WHERE e.folio=p.folio
     AND EXISTS(SELECT 1 FROM pos.exchange_items i JOIN known_products k ON k.id=i.product_id WHERE i.exchange_id=e.id)),
   'classification','REQUIRES_COMPLETE_PARENT_SCOPE')),'[]'::jsonb) FROM pos.sale_payments p),
 'nonqa_inventory',(SELECT jsonb_build_object('rows',count(*),'active',count(*) FILTER(WHERE deleted_at IS NULL),
   'active_families',count(DISTINCT reference_family_id) FILTER(WHERE deleted_at IS NULL),
   'active_v2_pieces',sum(stock_quantity) FILTER(WHERE deleted_at IS NULL AND record_model='v2'),
   'full_rows_md5',md5(coalesce(string_agg(md5(to_jsonb(p)::text),'' ORDER BY p.id),'')))
   FROM pos.products p WHERE NOT EXISTS(SELECT 1 FROM known_products k WHERE k.id=p.id)),
 'protected_sale_0001',(SELECT jsonb_build_object('folio',s.folio,'operation_id',s.operation_id,
   'row_md5',md5(to_jsonb(s)::text),'matches_known_qa_client',EXISTS(SELECT 1 FROM known_sales k WHERE k.client_id=s.cliente_id),
   'known_qa_product_lines',(SELECT count(*) FROM pos.sale_items i JOIN known_products k ON k.id=i.product_id WHERE i.folio=s.folio),
   'decision','PRESERVE_UNLESS_OWNER_AND_EXACT_RECEIPT_PROVE_OTHERWISE') FROM pos.sales s WHERE s.folio='BG-260912-0001'),
 'legacy_pending',(SELECT coalesce(jsonb_agg(jsonb_build_object('actor_id',o.actor_id,'device_id',o.device_id,
   'operation_id',o.operation_id,'payload_hash',o.payload_hash,'classification',o.classification,
   'archived_at',o.archived_at,'command_type',o.original->>'type',
   'original_keys',(SELECT jsonb_agg(k) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(o.original)='object' THEN o.original ELSE '{}'::jsonb END) k),
   'decision','PRESERVE_ORIGINAL_PENDING_OWNER_CLASSIFICATION')),'[]'::jsonb)
   FROM pos.online_legacy_operations o WHERE o.classification='needs_review'),
 'storage_groups',(SELECT coalesce(jsonb_agg(jsonb_build_object('bucket',s.bucket_id,'owner_id',s.owner_id,
   'first_component_md5',md5(coalesce(s.first_path_component,'')),'objects',s.objects,
   'first_created',s.first_created,'last_created',s.last_created,'referenced_by_current_or_history',s.url_suffix_referenced,
   'known_qa_id_in_path',s.known_qa_id_in_path,'metadata_rows_md5',s.metadata_rows_md5,
   'classification','UNKNOWN_STORAGE_PROVENANCE_NO_DELETION')),'[]'::jsonb) FROM storage_summary s),
 'limits',jsonb_build_array('No additional local manifests found for runs 69237da3 and 6d340d65; server protected marker and receipts required.',
  'Storage reference count does not prove ownership or orphan status. Private backups, encoded paths and historical exports may reference an object.',
  'Movement ref/operation_id reviewed separately because movements has no folio/folio_ref column.',
  'This is an inventory, not a payload backup or destructive action.',
  'The original XML FK diagnostic was invalid. Use H171 direct Auth FK counts; no cause of the earlier Auth failure is established.')
) AS report;
COMMIT;

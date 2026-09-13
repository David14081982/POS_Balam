-- H171 BALAM: disambiguate six QA receipts sharing an old commercial folio.
-- READ ONLY. Exact composite PK + expected fingerprint, never folio-only selection.
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
WITH targets(actor_id,request_id,expected_md5) AS (VALUES
 ('5d4ea7ba-d175-4b3a-8170-e84f0a8448d4'::uuid,'38bb7974-a453-48b0-b794-0ed57e82e1a0'::uuid,'39a158c7a65216af64ad13329b21d75d'),
 ('5d4ea7ba-d175-4b3a-8170-e84f0a8448d4'::uuid,'702ffdf8-53ac-590f-8d99-b5b8a4928116'::uuid,'ec23b1efb9977caa03663a9a136b8dac'),
 ('5d4ea7ba-d175-4b3a-8170-e84f0a8448d4'::uuid,'99e38258-921a-42eb-aa28-b4911fe62d81'::uuid,'954e5beeb831c9b33f90998799662424'),
 ('895b586d-15b7-40ae-8ce1-926492c2a229'::uuid,'a0293bc4-59df-49f6-9c88-49bc27aee2b8'::uuid,'a8c0fcfc15cd73c0114d209dc4d4c32b'),
 ('895b586d-15b7-40ae-8ce1-926492c2a229'::uuid,'b46e37a5-6169-5ffa-888e-7e3e8fc5b4ba'::uuid,'9ba975c6f447b87dfdbf63d576cc2abf'),
 ('895b586d-15b7-40ae-8ce1-926492c2a229'::uuid,'e509bd10-6de2-4dce-9ad5-584b861c4a9b'::uuid,'2d71f75bb7880ce2a12e52e527d5a927')
), receipts AS (
 SELECT r.*,md5(to_jsonb(r)::text)=t.expected_md5 AS unchanged_since_inventory
 FROM targets t JOIN pos.online_requests r USING(actor_id,request_id)
), identity_summary AS (
 SELECT actor_id,request_id,command_kind,state,device_id,created_at,completed_at,
 command_hash,md5(response::text) AS response_md5,unchanged_since_inventory,
 jsonb_path_query_array(response,'$.**.operation_id') AS operation_ids,
 jsonb_path_query_array(response,'$.**.operationId') AS camel_operation_ids,
 jsonb_path_query_array(response,'$.**._operationId') AS document_operation_ids,
 jsonb_path_query_array(response,'$.**.id') AS document_ids,
 jsonb_path_query_array(response,'$.**.folio') AS folios,
 jsonb_path_query_array(response,'$.**.origen_folio') AS origin_folios,
 jsonb_path_query_array(response,'$.**.product_id') AS product_ids,
 jsonb_path_query_array(response,'$.**.productId') AS camel_product_ids,
 jsonb_path_query_array(response,'$.**.line_id') AS line_ids,
 jsonb_path_query_array(response,'$.**.source_sale_line_id') AS source_sale_line_ids,
 EXISTS(SELECT 1 FROM jsonb_path_query(response,'strict $.** ? (@.type() == "string")') v(value)
   WHERE v.value#>>'{}'='35e2c61a-7561-41b9-9535-e39e671a55d3') AS contains_current_sale_operation
 FROM receipts
), current_sale AS (
 SELECT s.folio,s.operation_id,s.cliente_id,md5(to_jsonb(s)::text) AS row_md5,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'line_id',i.line_id,'product_id',i.product_id) ORDER BY i.id),'[]') FROM pos.sale_items i WHERE i.folio=s.folio) AS exact_line_identities
 FROM pos.sales s WHERE s.folio='BG-260912-0001'
 AND s.operation_id='35e2c61a-7561-41b9-9535-e39e671a55d3'
), commits AS (
 SELECT commit_id,operation_id,folio,payload_hash,md5(actor_email) AS actor_email_md5,created_at,
 md5(to_jsonb(c)::text) AS row_md5
 FROM pos.sale_commits c
 WHERE operation_id IN('38bb7974-a453-48b0-b794-0ed57e82e1a0','e509bd10-6de2-4dce-9ad5-584b861c4a9b','35e2c61a-7561-41b9-9535-e39e671a55d3')
)
SELECT jsonb_build_object('audit','H171 six exact QA receipts / reused folio',
 'project_ref','telohdbvbvsfmwyriflz','at',clock_timestamp(),'read_only',current_setting('transaction_read_only'),
 'expected_receipts',6,'matched_receipts',(SELECT count(*) FROM receipts),
 'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,request_id) FROM identity_summary r),
 'current_sale',(SELECT to_jsonb(s) FROM current_sale s),
 'exact_operation_commits',(SELECT jsonb_agg(to_jsonb(c) ORDER BY operation_id) FROM commits c),
 'limit','Read-only provenance. No receipt is reclassified or deleted; matching a folio alone proves nothing.') AS report;
COMMIT;

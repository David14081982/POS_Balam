-- BALAM H171 READ ONLY: exact protected request, known Auth set and linked audit.
-- No payload bodies, passwords, tokens, raw emails, IPs or raw SQL are exported.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL TimeZone='UTC';
SET LOCAL DateStyle='ISO, MDY';
DO $h171_request7054_inspection$
DECLARE item record; counts jsonb:='[]'::jsonb; part jsonb; audits jsonb:='[]'::jsonb;
 ids uuid[]:=ARRAY['0c854997-d4cb-4f5a-bf19-6640498c8219','272aed8a-fab0-48e0-b2ba-e65d3f0884b9','54633260-578a-4228-b7d1-4e36e6c49144','5d4ea7ba-d175-4b3a-8170-e84f0a8448d4','6dd83591-9e6b-482f-95e0-78470766cbce','720db98c-e653-4d86-8d5e-eab00a315959','7e869e19-be08-40fb-96e0-7e444795e8fa','85fd870d-1d81-484b-84d3-de60cd2576ec','895b586d-15b7-40ae-8ce1-926492c2a229','eb46cc84-1fe2-4da0-84b6-8332a7ff3bad','fb16c0b5-d9eb-4444-997c-c8e0c49f234b']::uuid[];
BEGIN
 FOR item IN SELECT c.conrelid::regclass::text AS relation,a.attname AS column_name,c.confdeltype AS effect
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
  WHERE c.contype='f' AND c.confrelid='auth.users'::regclass AND cardinality(c.conkey)=1
  ORDER BY c.conrelid::regclass::text,a.attname
 LOOP
  EXECUTE format('SELECT jsonb_agg(jsonb_build_object(''relation'',$2,''column'',$3,''effect'',$4,''id'',q.id,''rows'',q.rows) ORDER BY q.id) '
   ||'FROM(SELECT i.id,count(t.%I) AS rows FROM unnest($1::uuid[]) i(id) LEFT JOIN %s t ON t.%I=i.id GROUP BY i.id)q',
   item.column_name,item.relation,item.column_name)
   INTO part USING ids,item.relation,item.column_name,item.effect;
  counts:=counts||coalesce(part,'[]'::jsonb);
 END LOOP;
 IF to_regclass('auth.audit_log_entries') IS NOT NULL THEN
  BEGIN
   EXECUTE $q$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
     'id',j->>'id','created_at',j->>'created_at',
     'action',CASE WHEN j#>>'{payload,action}' ~ '^[A-Za-z0-9_.-]{1,64}$' THEN j#>>'{payload,action}' END,
     'log_type',CASE WHEN j#>>'{payload,log_type}' ~ '^[A-Za-z0-9_.-]{1,64}$' THEN j#>>'{payload,log_type}' END,
     'actor_id',CASE WHEN j#>>'{payload,actor_id}' ~ '^[0-9a-fA-F-]{36}$' THEN j#>>'{payload,actor_id}' END,
     'mentions_exact_target',jsonb_path_exists(j,'$.** ? (@ == $id)',jsonb_build_object('id','6dd83591-9e6b-482f-95e0-78470766cbce')),
     'mentions_exact_request',jsonb_path_exists(j,'$.** ? (@ == $id)',jsonb_build_object('id','70549527-4867-4342-94d2-38e770b0f2a9'))
    ) ORDER BY j->>'created_at'),'[]'::jsonb)
    FROM(SELECT to_jsonb(t) AS j FROM auth.audit_log_entries t) s
    WHERE jsonb_path_exists(j,'$.** ? (@ == $id)',jsonb_build_object('id','6dd83591-9e6b-482f-95e0-78470766cbce'))
     OR jsonb_path_exists(j,'$.** ? (@ == $id)',jsonb_build_object('id','70549527-4867-4342-94d2-38e770b0f2a9'))
   $q$ INTO audits;
  EXCEPTION WHEN insufficient_privilege THEN audits:=jsonb_build_array(jsonb_build_object('status','insufficient_privilege'));
  END;
 END IF;
 PERFORM set_config('h171.request7054_extra',jsonb_build_object('auth_fk_counts',counts,'auth_audit_exact_links',audits)::text,true);
END $h171_request7054_inspection$;
WITH known(id) AS (SELECT unnest(ARRAY['0c854997-d4cb-4f5a-bf19-6640498c8219','272aed8a-fab0-48e0-b2ba-e65d3f0884b9','54633260-578a-4228-b7d1-4e36e6c49144','5d4ea7ba-d175-4b3a-8170-e84f0a8448d4','6dd83591-9e6b-482f-95e0-78470766cbce','720db98c-e653-4d86-8d5e-eab00a315959','7e869e19-be08-40fb-96e0-7e444795e8fa','85fd870d-1d81-484b-84d3-de60cd2576ec','895b586d-15b7-40ae-8ce1-926492c2a229','eb46cc84-1fe2-4da0-84b6-8332a7ff3bad','fb16c0b5-d9eb-4444-997c-c8e0c49f234b']::uuid[])),
linked AS (
 SELECT 'online_requests' AS table_name,to_jsonb(t) AS j FROM pos.online_requests t
 UNION ALL SELECT 'capability_operation_audit',to_jsonb(t) FROM pos.capability_operation_audit t
 UNION ALL SELECT 'permission_change_audit',to_jsonb(t) FROM pos.permission_change_audit t
)
SELECT jsonb_build_object(
 'audit','H171 exact protected7054 completion evidence','project_ref','telohdbvbvsfmwyriflz',
 'at',clock_timestamp(),'read_only',current_setting('transaction_read_only'),
 'revision',(SELECT revision FROM pos.online_snapshot_revision WHERE singleton),
 'request',(SELECT jsonb_build_object(
  'actor_id',r.actor_id,'request_id',r.request_id,'action',r.action,'state',r.state,
  'target_user_id',r.target_user_id,'created_at',r.created_at,'updated_at',r.updated_at,
  'row_md5',md5(to_jsonb(r)::text),'payload_hash_unchanged_reference',r.payload_hash,
  'result_ok',r.result->'ok',
  'result_code',CASE WHEN r.result->>'code' ~ '^[A-Za-z0-9_.-]{1,64}$' THEN r.result->>'code' END,
  'result_auth_deleted',r.result->'authDeleted','result_profile_deleted',r.result->'profileDeleted',
  'result_mentions_exact_target',jsonb_path_exists(r.result,'$.** ? (@ == $id)',jsonb_build_object('id','6dd83591-9e6b-482f-95e0-78470766cbce')),
  'actor_is_protected_real',r.actor_id='3f24222e-fd74-4ed2-b56f-f298af574b1e',
  'target_is_exact_known_qa',r.target_user_id='6dd83591-9e6b-482f-95e0-78470766cbce'
 ) FROM pos.online_account_requests r WHERE r.request_id='70549527-4867-4342-94d2-38e770b0f2a9'),
 'known_auth',(SELECT jsonb_agg(jsonb_build_object(
  'id',k.id,'exists',u.id IS NOT NULL,'created_at',u.created_at,
  'email_md5',md5(u.email),'banned_until',u.banned_until,'deleted_at',u.deleted_at
 ) ORDER BY k.id) FROM known k LEFT JOIN auth.users u ON u.id=k.id),
 'target_profile_exists',EXISTS(SELECT 1 FROM pos.sellers WHERE id='6dd83591-9e6b-482f-95e0-78470766cbce'),
 'related_audit',(SELECT coalesce(jsonb_agg(jsonb_build_object(
  'table',table_name,'row_md5',md5(j::text),'actor_id',coalesce(j->>'actor_id',j->>'actor_user_id'),
  'request_id',j->>'request_id','operation_id',j->>'operation_id','created_at',j->>'created_at',
  'completed_at',j->>'completed_at','state',j->>'state','command_kind',j->>'command_kind',
  'capability_key',j->>'capability_key'
 )),'[]'::jsonb) FROM linked
 WHERE jsonb_path_exists(j,'$.** ? (@ == $id)',jsonb_build_object('id','6dd83591-9e6b-482f-95e0-78470766cbce'))
  OR jsonb_path_exists(j,'$.** ? (@ == $id)',jsonb_build_object('id','70549527-4867-4342-94d2-38e770b0f2a9'))),
 'extra',current_setting('h171.request7054_extra')::jsonb,
 'limits',jsonb_build_array('A completed receipt establishes recorded actor/target/state; it does not alone identify the process that retried the request.','No raw result/payload or Auth credential is exported. Missing Auth audit links do not prove absence of gateway activity.')
) AS report;
COMMIT;

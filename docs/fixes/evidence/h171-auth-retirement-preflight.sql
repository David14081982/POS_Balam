-- H171 exact Auth retirement preflight; no mutation or credentials.
BEGIN READ ONLY;
SET LOCAL statement_timeout='60s';
SET LOCAL TimeZone='UTC';
SET LOCAL DateStyle='ISO, MDY';
WITH targets(id) AS (VALUES ('0c854997-d4cb-4f5a-bf19-6640498c8219'::uuid),('272aed8a-fab0-48e0-b2ba-e65d3f0884b9'::uuid),('54633260-578a-4228-b7d1-4e36e6c49144'::uuid),('5d4ea7ba-d175-4b3a-8170-e84f0a8448d4'::uuid),('6dd83591-9e6b-482f-95e0-78470766cbce'::uuid),('720db98c-e653-4d86-8d5e-eab00a315959'::uuid),('7e869e19-be08-40fb-96e0-7e444795e8fa'::uuid),('85fd870d-1d81-484b-84d3-de60cd2576ec'::uuid),('895b586d-15b7-40ae-8ce1-926492c2a229'::uuid),('eb46cc84-1fe2-4da0-84b6-8332a7ff3bad'::uuid),('fb16c0b5-d9eb-4444-997c-c8e0c49f234b'::uuid)), fk_counts AS (SELECT t.id, 'auth.identities'::text relation,
 'user_id'::text "column", 'c'::text effect, count(d.user_id) rows
 FROM targets t LEFT JOIN auth.identities d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'auth.mfa_factors'::text relation,
 'user_id'::text "column", 'c'::text effect, count(d.user_id) rows
 FROM targets t LEFT JOIN auth.mfa_factors d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'auth.oauth_authorizations'::text relation,
 'user_id'::text "column", 'c'::text effect, count(d.user_id) rows
 FROM targets t LEFT JOIN auth.oauth_authorizations d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'auth.oauth_consents'::text relation,
 'user_id'::text "column", 'c'::text effect, count(d.user_id) rows
 FROM targets t LEFT JOIN auth.oauth_consents d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'auth.one_time_tokens'::text relation,
 'user_id'::text "column", 'c'::text effect, count(d.user_id) rows
 FROM targets t LEFT JOIN auth.one_time_tokens d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'auth.sessions'::text relation,
 'user_id'::text "column", 'c'::text effect, count(d.user_id) rows
 FROM targets t LEFT JOIN auth.sessions d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'auth.webauthn_challenges'::text relation,
 'user_id'::text "column", 'c'::text effect, count(d.user_id) rows
 FROM targets t LEFT JOIN auth.webauthn_challenges d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'auth.webauthn_credentials'::text relation,
 'user_id'::text "column", 'c'::text effect, count(d.user_id) rows
 FROM targets t LEFT JOIN auth.webauthn_credentials d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.capability_operation_audit'::text relation,
 'actor_user_id'::text "column", 'a'::text effect, count(d.actor_user_id) rows
 FROM targets t LEFT JOIN pos.capability_operation_audit d ON d.actor_user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.permission_roles'::text relation,
 'updated_by'::text "column", 'n'::text effect, count(d.updated_by) rows
 FROM targets t LEFT JOIN pos.permission_roles d ON d.updated_by=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.role_screen_permissions'::text relation,
 'updated_by'::text "column", 'n'::text effect, count(d.updated_by) rows
 FROM targets t LEFT JOIN pos.role_screen_permissions d ON d.updated_by=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.screen_permission_catalog_state'::text relation,
 'updated_by'::text "column", 'n'::text effect, count(d.updated_by) rows
 FROM targets t LEFT JOIN pos.screen_permission_catalog_state d ON d.updated_by=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.user_capability_overrides'::text relation,
 'updated_by'::text "column", 'n'::text effect, count(d.updated_by) rows
 FROM targets t LEFT JOIN pos.user_capability_overrides d ON d.updated_by=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.user_permission_role_assignments'::text relation,
 'updated_by'::text "column", 'n'::text effect, count(d.updated_by) rows
 FROM targets t LEFT JOIN pos.user_permission_role_assignments d ON d.updated_by=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.user_screen_permission_overrides'::text relation,
 'updated_by'::text "column", 'n'::text effect, count(d.updated_by) rows
 FROM targets t LEFT JOIN pos.user_screen_permission_overrides d ON d.updated_by=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.user_capability_overrides'::text relation,
 'user_id'::text "column", 'c'::text effect, count(d.user_id) rows
 FROM targets t LEFT JOIN pos.user_capability_overrides d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.user_permission_role_assignments'::text relation,
 'user_id'::text "column", 'c'::text effect, count(d.user_id) rows
 FROM targets t LEFT JOIN pos.user_permission_role_assignments d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.user_screen_permission_overrides'::text relation,
 'user_id'::text "column", 'c'::text effect, count(d.user_id) rows
 FROM targets t LEFT JOIN pos.user_screen_permission_overrides d ON d.user_id=t.id GROUP BY t.id),
fk_catalog AS (
 SELECT n.nspname||'.'||r.relname relation, c.confdeltype::text effect, c.convalidated validated,
  (SELECT jsonb_agg(a.attname ORDER BY u.ord) FROM unnest(c.conkey) WITH ORDINALITY u(attnum,ord)
   JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.attnum) columns,
  (SELECT jsonb_agg(a.attname ORDER BY u.ord) FROM unnest(c.confkey) WITH ORDINALITY u(attnum,ord)
   JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=u.attnum) referenced_columns
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
 WHERE c.contype='f' AND c.confrelid='auth.users'::regclass
)
SELECT jsonb_build_object('audit','H171 Auth retirement preflight','at',clock_timestamp(),
 'project_ref','telohdbvbvsfmwyriflz','read_only',current_setting('transaction_read_only'),
 'real_actor_exists',EXISTS(SELECT 1 FROM auth.users WHERE id='3f24222e-fd74-4ed2-b56f-f298af574b1e'::uuid),
 'real_actor_can_manage',pos.can_manage_screen_permissions('3f24222e-fd74-4ed2-b56f-f298af574b1e'::uuid),
 'protected_request_id','70549527-4867-4342-94d2-38e770b0f2a9',
 'protected_request_md5',(SELECT md5(to_jsonb(t)::text) FROM pos.online_account_requests t WHERE request_id='70549527-4867-4342-94d2-38e770b0f2a9'::uuid),
 'fk_catalog',(SELECT jsonb_agg(to_jsonb(t) ORDER BY relation,columns::text) FROM fk_catalog t),
 'fk_counts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id,relation,"column") FROM fk_counts t),
 'identities',(SELECT jsonb_agg(jsonb_build_object('id',u.id,'email_md5',md5(u.email),
  'created_at',u.created_at,'qa_metadata',jsonb_strip_nulls(jsonb_build_object(
   'balam_online_test',u.raw_user_meta_data->'balam_online_test',
   'balam_sync_test',u.raw_user_meta_data->'balam_sync_test',
   'balam_account_request_id',u.raw_app_meta_data->'balam_account_request_id'))) ORDER BY u.id)
  FROM auth.users u JOIN targets t ON t.id=u.id)
) report;
COMMIT;

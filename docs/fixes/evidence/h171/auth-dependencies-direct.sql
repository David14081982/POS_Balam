-- H171 corrected FK census. Direct aggregate counts; no XML or mutations.
BEGIN READ ONLY;
SET LOCAL statement_timeout='60s';
WITH targets(id) AS (VALUES ('0c854997-d4cb-4f5a-bf19-6640498c8219'::uuid),('272aed8a-fab0-48e0-b2ba-e65d3f0884b9'::uuid),('54633260-578a-4228-b7d1-4e36e6c49144'::uuid),('5d4ea7ba-d175-4b3a-8170-e84f0a8448d4'::uuid),('6dd83591-9e6b-482f-95e0-78470766cbce'::uuid),('720db98c-e653-4d86-8d5e-eab00a315959'::uuid),('7e869e19-be08-40fb-96e0-7e444795e8fa'::uuid),('85fd870d-1d81-484b-84d3-de60cd2576ec'::uuid),('895b586d-15b7-40ae-8ce1-926492c2a229'::uuid),('eb46cc84-1fe2-4da0-84b6-8332a7ff3bad'::uuid),('fb16c0b5-d9eb-4444-997c-c8e0c49f234b'::uuid)), counts AS (SELECT t.id, 'auth.identities'::text AS relation, 'user_id'::text AS column_name, 'CASCADE'::text AS deletion_effect, count(d.user_id) AS rows FROM targets t LEFT JOIN auth.identities d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'auth.mfa_factors'::text AS relation, 'user_id'::text AS column_name, 'CASCADE'::text AS deletion_effect, count(d.user_id) AS rows FROM targets t LEFT JOIN auth.mfa_factors d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'auth.oauth_authorizations'::text AS relation, 'user_id'::text AS column_name, 'CASCADE'::text AS deletion_effect, count(d.user_id) AS rows FROM targets t LEFT JOIN auth.oauth_authorizations d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'auth.oauth_consents'::text AS relation, 'user_id'::text AS column_name, 'CASCADE'::text AS deletion_effect, count(d.user_id) AS rows FROM targets t LEFT JOIN auth.oauth_consents d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'auth.one_time_tokens'::text AS relation, 'user_id'::text AS column_name, 'CASCADE'::text AS deletion_effect, count(d.user_id) AS rows FROM targets t LEFT JOIN auth.one_time_tokens d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'auth.sessions'::text AS relation, 'user_id'::text AS column_name, 'CASCADE'::text AS deletion_effect, count(d.user_id) AS rows FROM targets t LEFT JOIN auth.sessions d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'auth.webauthn_challenges'::text AS relation, 'user_id'::text AS column_name, 'CASCADE'::text AS deletion_effect, count(d.user_id) AS rows FROM targets t LEFT JOIN auth.webauthn_challenges d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'auth.webauthn_credentials'::text AS relation, 'user_id'::text AS column_name, 'CASCADE'::text AS deletion_effect, count(d.user_id) AS rows FROM targets t LEFT JOIN auth.webauthn_credentials d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.capability_operation_audit'::text AS relation, 'actor_user_id'::text AS column_name, 'NO ACTION'::text AS deletion_effect, count(d.actor_user_id) AS rows FROM targets t LEFT JOIN pos.capability_operation_audit d ON d.actor_user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.permission_roles'::text AS relation, 'updated_by'::text AS column_name, 'SET NULL'::text AS deletion_effect, count(d.updated_by) AS rows FROM targets t LEFT JOIN pos.permission_roles d ON d.updated_by=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.role_screen_permissions'::text AS relation, 'updated_by'::text AS column_name, 'SET NULL'::text AS deletion_effect, count(d.updated_by) AS rows FROM targets t LEFT JOIN pos.role_screen_permissions d ON d.updated_by=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.screen_permission_catalog_state'::text AS relation, 'updated_by'::text AS column_name, 'SET NULL'::text AS deletion_effect, count(d.updated_by) AS rows FROM targets t LEFT JOIN pos.screen_permission_catalog_state d ON d.updated_by=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.user_capability_overrides'::text AS relation, 'updated_by'::text AS column_name, 'SET NULL'::text AS deletion_effect, count(d.updated_by) AS rows FROM targets t LEFT JOIN pos.user_capability_overrides d ON d.updated_by=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.user_capability_overrides'::text AS relation, 'user_id'::text AS column_name, 'CASCADE'::text AS deletion_effect, count(d.user_id) AS rows FROM targets t LEFT JOIN pos.user_capability_overrides d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.user_permission_role_assignments'::text AS relation, 'updated_by'::text AS column_name, 'SET NULL'::text AS deletion_effect, count(d.updated_by) AS rows FROM targets t LEFT JOIN pos.user_permission_role_assignments d ON d.updated_by=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.user_permission_role_assignments'::text AS relation, 'user_id'::text AS column_name, 'CASCADE'::text AS deletion_effect, count(d.user_id) AS rows FROM targets t LEFT JOIN pos.user_permission_role_assignments d ON d.user_id=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.user_screen_permission_overrides'::text AS relation, 'updated_by'::text AS column_name, 'SET NULL'::text AS deletion_effect, count(d.updated_by) AS rows FROM targets t LEFT JOIN pos.user_screen_permission_overrides d ON d.updated_by=t.id GROUP BY t.id
UNION ALL
SELECT t.id, 'pos.user_screen_permission_overrides'::text AS relation, 'user_id'::text AS column_name, 'CASCADE'::text AS deletion_effect, count(d.user_id) AS rows FROM targets t LEFT JOIN pos.user_screen_permission_overrides d ON d.user_id=t.id GROUP BY t.id)
SELECT jsonb_build_object('audit','H171 direct Auth FK counts','at',clock_timestamp(),'read_only',current_setting('transaction_read_only'),'counts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id,relation,column_name) FROM counts c),'limitation','FK counts identify dependent rows; they do not prove the cause of an earlier Auth API error') AS report;
COMMIT;

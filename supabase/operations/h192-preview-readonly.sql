-- Private owner preview. Output contains account names/identities: do not publish.
begin read only;
select jsonb_build_object(
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
) evidence;
commit;

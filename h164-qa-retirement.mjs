// Privileged, Node-only teardown of the exact H164 certification fixtures.
// Produces reviewable SQL; this module performs no network or filesystem action.
import assert from 'node:assert/strict';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function qaRetirementPlan(fixtures,{project,build}){
  assert.match(fixtures.run,uuid);assert.equal(fixtures.prefix,'qa-h164-'+fixtures.run);
  assert.match(fixtures.userId,uuid);assert.match(fixtures.accountRequestId,uuid);
  assert.equal(fixtures.email,fixtures.prefix+'@example.test');assert.match(project,/^[a-z0-9]{20}$/);
  assert.match(build,/^\d{4}-\d{2}-\d{2}-h(?:164|166)-online$/);
  assert.equal(fixtures.createdAccountIds.length,1,'This matrix created exactly one additional QA access account');
  const accountId=fixtures.createdAccountIds[0];assert.match(accountId,uuid);assert.notEqual(accountId,fixtures.userId);
  const prefix=fixtures.prefix;
  const profiles=[{id:prefix+'-admin',nombre:prefix+' Admin',email:fixtures.email,role:'admin'},
    ...['A','B','C'].map((letter,index)=>({id:prefix+'-seller-'+letter,nombre:prefix+' '+index,email:null,role:'vendedor'})),
    {id:accountId,nombre:prefix+' Account',email:prefix+'-account@example.test',role:'vendedor'}];
  assert.deepEqual([...fixtures.sellers].sort(),profiles.map(row=>row.id).sort(),'Only the five journaled QA profiles may be retired');
  assert.deepEqual(fixtures.installations,['A','B','C'].map(letter=>prefix+'-'+letter));
  return {run:fixtures.run,prefix,project,build,userId:fixtures.userId,email:fixtures.email,accountId,accountRequestId:fixtures.accountRequestId,profiles,installations:fixtures.installations.slice()};
}

export function qaRetirementSql(plan){
  const literal="'"+JSON.stringify(plan).replaceAll("'","''")+"'::jsonb";
  return `-- Exact H164 QA teardown. No grants, trigger disabling, deletion, or device reactivation.
begin;
set local lock_timeout='10s';
set local statement_timeout='60s';
do $h164_qa_retire$
declare
 p jsonb := ${literal};
 ids text[]; devices text[]; own_before jsonb; own_after jsonb; other_before jsonb; device_before jsonb;
 changed integer;
begin
 if current_user <> 'postgres' or auth.uid() is not null then
  raise exception 'H164_QA_OWNER_CONTEXT_REQUIRED';
 end if;
 if not exists(select 1 from pos.system_manifest where singleton and system_mode='preproduction') then
  raise exception 'H164_QA_PREPRODUCTION_REQUIRED';
 end if;
 select array_agg(x->>'id' order by x->>'id') into ids from jsonb_array_elements(p->'profiles') x;
 select array_agg(x order by x) into devices from jsonb_array_elements_text(p->'installations') x;
 if cardinality(ids)<>5 or cardinality(devices)<>3 then raise exception 'H164_QA_TARGET_SCOPE_INVALID'; end if;
 perform 1 from auth.users where id in((p->>'userId')::uuid,(p->>'accountId')::uuid) order by id for update;
 if not exists(select 1 from auth.users where id=(p->>'userId')::uuid and email=p->>'email'
   and raw_user_meta_data->>'balam_online_test'=p->>'run') then raise exception 'H164_QA_ACTOR_MARKER_MISMATCH'; end if;
 if not exists(select 1 from auth.users where id=(p->>'accountId')::uuid and email=(p->>'prefix')||'-account@example.test'
   and raw_app_meta_data->>'balam_account_request_id'=p->>'accountRequestId') then raise exception 'H164_QA_ACCOUNT_MARKER_MISMATCH'; end if;
 if not exists(select 1 from pos.online_account_requests where actor_id=(p->>'userId')::uuid
   and request_id=(p->>'accountRequestId')::uuid and target_user_id=(p->>'accountId')::uuid
   and state='completed' and result->>'ok'='true') then raise exception 'H164_QA_ACCOUNT_RECEIPT_MISMATCH'; end if;
 perform 1 from pos.sellers where id=any(ids) order by id for update;
 if (select count(*) from pos.sellers where id=any(ids))<>5 or exists(
   select 1 from jsonb_array_elements(p->'profiles') expected left join pos.sellers s on s.id=expected->>'id'
   where s.id is null or s.deleted_at is not null or s.nombre is distinct from expected->>'nombre'
    or s.role is distinct from expected->>'role' or s.email is distinct from expected->>'email') then
  raise exception 'H164_QA_PROFILE_SCOPE_MISMATCH';
 end if;
 perform 1 from pos.sync_devices where device_id=any(devices) order by device_id for share;
 if (select count(*) from pos.sync_devices where device_id=any(devices) and status='revoked' and user_id=(p->>'userId')::uuid)<>3 then
  raise exception 'H164_QA_INSTALLATIONS_MUST_REMAIN_RETIRED';
 end if;
 select jsonb_agg(to_jsonb(s)-array['active','sync_version','sync_base_version','updated_at','sync_device_id'] order by s.id)
  into own_before from pos.sellers s where id=any(ids);
 select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) into other_before from pos.sellers s where not(id=any(ids));
 select jsonb_agg(to_jsonb(d) order by d.device_id) into device_before from pos.sync_devices d where device_id=any(devices);
 -- A stored origin is historical evidence. This owner maintenance transaction
 -- has no device actor, so prevent the legacy fence from using a retired origin.
 perform set_config('request.headers',jsonb_build_object('x-balam-client-build',p->>'build')::text,true);
 perform set_config('pos.h149_rpc','on',true);
 perform set_config('pos.h149_device','',true);
 update pos.sellers set active=false,sync_base_version=sync_version where id=any(ids) and active is distinct from false;
 get diagnostics changed=row_count;
 if exists(select 1 from pos.sellers where id=any(ids) and active is distinct from false) then raise exception 'H164_QA_PROFILE_RETIREMENT_UNCONFIRMED'; end if;
 select jsonb_agg(to_jsonb(s)-array['active','sync_version','sync_base_version','updated_at','sync_device_id'] order by s.id)
  into own_after from pos.sellers s where id=any(ids);
 if own_after is distinct from own_before then raise exception 'H164_QA_FINANCIAL_HISTORY_CHANGED'; end if;
 if other_before is distinct from(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from pos.sellers s where not(id=any(ids))) then
  raise exception 'H164_QA_OTHER_PROFILE_CHANGED';
 end if;
 if device_before is distinct from(select jsonb_agg(to_jsonb(d) order by d.device_id) from pos.sync_devices d where device_id=any(devices)) then
  raise exception 'H164_QA_DEVICE_HISTORY_CHANGED';
 end if;
 perform set_config('balam_qa.retirement_result',jsonb_build_object('ok',true,'run',p->>'run','retiredProfileIds',to_jsonb(ids),'changedProfiles',changed,'financialHistoryUnchanged',true,'otherProfilesUnchanged',true,'devicesUnchanged',true)::text,true);
end $h164_qa_retire$;
set constraints all immediate;
select current_setting('balam_qa.retirement_result')::jsonb as result;
commit;
`;
}

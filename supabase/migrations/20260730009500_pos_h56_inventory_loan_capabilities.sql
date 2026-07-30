begin;
insert into pos.operational_capabilities(capability_key,description) values
 ('inventory.loan.deliver','Entregar mercancía en préstamo'),
 ('inventory.loan.return','Registrar devolución de préstamo'),
 ('inventory.loan.shortage','Declarar faltante de préstamo'),
 ('inventory.loan.close','Cerrar préstamo automáticamente'),
 ('inventory.loan.edit','Editar préstamo sin eventos'),
 ('inventory.loan.delete','Dar de baja préstamo sin eventos'),
 ('inventory.loan.reopen','Reabrir préstamo no devuelto')
on conflict(capability_key) do update set description=excluded.description,active=true,updated_at=now();
insert into pos.role_capability_permissions(role_code,capability_key,allowed)
select 'admin',capability_key,true from pos.operational_capabilities
where capability_key like 'inventory.loan.%'
on conflict(role_code,capability_key) do update set allowed=true,updated_at=now();

create table if not exists pos.loan_documents(
 id text primary key,
 folio text not null unique,
 state text not null check(state in('pendiente','devuelto','no_devuelto')),
 document jsonb not null,
 version bigint not null default 1,
 has_events boolean not null default false,
 deleted_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table pos.loan_documents enable row level security;
drop policy if exists loan_admin_select on pos.loan_documents;
create policy loan_admin_select on pos.loan_documents for select to authenticated
 using(pos.is_active_admin());
revoke all on pos.loan_documents from public,anon,authenticated;
grant select on pos.loan_documents to authenticated;

create or replace function pos.commit_loan_operation(
 p_operation_id uuid,p_action text,p_loan jsonb,p_expected_version bigint default 0
) returns jsonb language plpgsql security definer set search_path=pos,pg_temp as $$
declare
 v_actor uuid:=auth.uid(); v_id text:=p_loan->>'id'; v_folio text:=p_loan->>'folio';
 v_new_state text:=p_loan->>'estado'; v_old pos.loan_documents%rowtype;
 v_cap text:='inventory.loan.'||p_action; v_hash text;
 v_result jsonb; v_has_events boolean;
begin
 if p_action not in('deliver','return','shortage','edit','delete','reopen')
 or p_operation_id is null or nullif(trim(v_id),'') is null then
  raise exception 'INVALID_LOAN_OPERATION' using errcode='22023';
 end if;
 perform pos.require_current_capability(v_cap);
 perform pg_advisory_xact_lock(hashtext(v_id));
 v_hash:=md5(jsonb_build_array(p_action,p_loan,p_expected_version)::text);
 select result into v_result from pos.capability_operation_audit
  where operation_id=p_operation_id and capability_key=v_cap and payload_hash=v_hash;
 if found then return v_result; end if;
 if exists(select 1 from pos.capability_operation_audit where operation_id=p_operation_id)
 then raise exception 'LOAN_OPERATION_CONFLICT' using errcode='40001'; end if;
 select * into v_old from pos.loan_documents where id=v_id for update;

 if p_action='deliver' then
  if found or v_new_state<>'pendiente' or nullif(trim(v_folio),'') is null
  or jsonb_typeof(p_loan->'lineas')<>'array'
  or jsonb_array_length(p_loan->'lineas')=0 then
   raise exception 'INVALID_LOAN_DELIVERY' using errcode='22023'; end if;
  insert into pos.loan_documents(id,folio,state,document)
  values(v_id,v_folio,'pendiente',p_loan);
 else
  if not found or v_old.deleted_at is not null
  then raise exception 'LOAN_NOT_FOUND' using errcode='P0002'; end if;
  if v_old.version<>coalesce(p_expected_version,0)
  then raise exception 'LOAN_VERSION_CONFLICT' using errcode='40001'; end if;
  if p_action in('edit','delete') and
    (v_old.has_events or v_old.state<>'pendiente') then
   raise exception 'LOAN_ALREADY_HAS_EFFECTS' using errcode='23514'; end if;
  if p_action='return' then
   if v_old.state='devuelto' or v_new_state not in('pendiente','devuelto')
   then raise exception 'INVALID_LOAN_RETURN' using errcode='23514'; end if;
   if v_old.state='no_devuelto' then
    perform pos.require_current_capability('inventory.loan.reopen');
   end if;
   if v_new_state='devuelto' then
    perform pos.require_current_capability('inventory.loan.close');
   end if;
   v_has_events:=true;
  elsif p_action='shortage' then
   if v_old.state<>'pendiente' or v_new_state<>'no_devuelto'
   then raise exception 'INVALID_LOAN_SHORTAGE' using errcode='23514'; end if;
   perform pos.require_current_capability('inventory.loan.close');
   v_has_events:=true;
  elsif p_action='reopen' then
   if v_old.state<>'no_devuelto' or v_new_state<>'pendiente'
   then raise exception 'INVALID_LOAN_REOPEN' using errcode='23514'; end if;
   v_has_events:=true;
  elsif p_action='delete' then
   update pos.loan_documents set deleted_at=now(),version=version+1,updated_at=now()
    where id=v_id returning jsonb_build_object('id',id,'version',version,
      'deleted_at',deleted_at) into v_result;
  end if;
  if p_action<>'delete' then
   update pos.loan_documents set document=p_loan,state=v_new_state,
    has_events=coalesce(v_has_events,has_events),version=version+1,updated_at=now()
   where id=v_id returning document||jsonb_build_object('_loanVersion',version)
    into v_result;
  end if;
 end if;
 if p_action='deliver' then
  select document||jsonb_build_object('_loanVersion',version) into v_result
  from pos.loan_documents where id=v_id;
 end if;
 insert into pos.capability_operation_audit(operation_id,capability_key,
  actor_user_id,subject_key,payload_hash,result)
 values(p_operation_id,v_cap,v_actor,v_id,v_hash,v_result);
 return v_result;
end; $$;
revoke all on function pos.commit_loan_operation(uuid,text,jsonb,bigint)
 from public,anon;
grant execute on function pos.commit_loan_operation(uuid,text,jsonb,bigint)
 to authenticated;
commit;

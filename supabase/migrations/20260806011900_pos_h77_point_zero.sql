-- H-77: linea base auditable (punto cero) y activacion del protocolo vivo.
begin;

create table if not exists pos.inventory_sync_baselines (
  data_epoch bigint primary key,
  product_count bigint not null,
  piece_count numeric not null,
  fingerprint text not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
alter table pos.inventory_sync_baselines enable row level security;
revoke all on pos.inventory_sync_baselines from public,anon,authenticated;
grant select on pos.inventory_sync_baselines to authenticated;
drop policy if exists inventory_sync_baselines_read on pos.inventory_sync_baselines;
create policy inventory_sync_baselines_read on pos.inventory_sync_baselines
  for select to authenticated using (pos.is_active_admin());

create or replace function pos.establish_sync_point_zero(
  p_protocol_version integer,
  p_expected_epoch bigint
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pos
as $$
declare
  v_epoch bigint; v_products bigint; v_pieces numeric; v_fingerprint text;
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception 'sync_point_zero_forbidden';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pos.sync.point-zero',0));
  perform pos.assert_sync_write_context(p_protocol_version,p_expected_epoch);

  select count(distinct p.id), coalesce(sum(coalesce((s.item->>'stock')::numeric,0)),0)
    into v_products,v_pieces
  from pos.products p
  left join lateral jsonb_array_elements(coalesce(p.stock,'[]'::jsonb)) s(item) on true
  where p.deleted_at is null;
  select md5(coalesce(string_agg(to_jsonb(p)::text,'|' order by p.id),''))
    into v_fingerprint from pos.products p where p.deleted_at is null;

  update pos.system_manifest set data_epoch=data_epoch+1,updated_at=now()
    where singleton returning data_epoch into v_epoch;
  insert into pos.inventory_sync_baselines(
    data_epoch,product_count,piece_count,fingerprint,created_by
  ) values(v_epoch,v_products,v_pieces,v_fingerprint,auth.uid());
  -- También marca a quien inició; su heartbeat posterior confirma la época
  -- nueva. Así no se depende de encabezados opcionales de PostgREST.
  update pos.sync_devices set status='must_rebootstrap';
  perform pos.bump_sync_domain('products','point-zero');
  perform pos.bump_sync_domain('config','point-zero');
  return jsonb_build_object('ok',true,'data_epoch',v_epoch,
    'product_count',v_products,'piece_count',v_pieces,'fingerprint',v_fingerprint);
end;
$$;
revoke all on function pos.establish_sync_point_zero(integer,bigint) from public,anon;
grant execute on function pos.establish_sync_point_zero(integer,bigint) to authenticated;

update pos.system_manifest set
  schema_version=greatest(schema_version,20260806011900),
  domain_modes='{"config":"active","products":"active","clients":"active","sellers":"active","promotions":"active","sales":"active","payments":"active","returns":"active","exchanges":"active","loans":"active","liquidations":"active","movements":"active","permissions":"active","purges":"active"}'::jsonb,
  updated_at=now()
where singleton;

commit;

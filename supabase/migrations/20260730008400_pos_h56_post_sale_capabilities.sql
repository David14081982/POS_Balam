-- H-56 Fase 5 grupo 2: fronteras de capacidad para devoluciones y cambios.
--
-- Las funciones transaccionales vigentes se conservan sin reescribir. Se
-- retira su exposición directa y se publican wrappers de igual transacción que
-- resuelven la capacidad antes de entrar al contrato comercial.

begin;

create or replace function pos.commit_return_checked(
  p_commit_id text,
  p_return jsonb,
  p_items jsonb,
  p_moves jsonb,
  p_stock_lines jsonb,
  p_client_effect jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb,
  p_legacy boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
begin
  perform pos.require_current_capability('sales.refund');
  return pos.commit_return(
    p_commit_id, p_return, p_items, p_moves, p_stock_lines,
    p_client_effect, p_seller_effects, p_legacy
  );
end;
$$;

create or replace function pos.commit_exchange_checked(
  p_commit_id text,
  p_exchange jsonb,
  p_items jsonb,
  p_moves jsonb default '[]'::jsonb,
  p_payment jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
begin
  perform pos.require_current_capability('sales.exchange');
  return pos.commit_exchange(
    p_commit_id, p_exchange, p_items, p_moves, p_payment, p_seller_effects
  );
end;
$$;

revoke all on function pos.commit_return(
  text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean
) from public, anon, authenticated;
revoke all on function pos.commit_exchange(
  text, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;

revoke all on function pos.commit_return_checked(
  text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean
) from public, anon;
grant execute on function pos.commit_return_checked(
  text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean
) to authenticated;

revoke all on function pos.commit_exchange_checked(
  text, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function pos.commit_exchange_checked(
  text, jsonb, jsonb, jsonb, jsonb, jsonb
) to authenticated;

comment on function pos.commit_return_checked(
  text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean
) is 'H-56: frontera pública de devolución; exige sales.refund y delega en la transacción vigente.';
comment on function pos.commit_exchange_checked(
  text, jsonb, jsonb, jsonb, jsonb, jsonb
) is 'H-56: frontera pública de cambio; exige sales.exchange y delega en la transacción vigente.';

commit;

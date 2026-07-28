-- H-37 (C4) · Modelo del cambio de mercancía
--
-- Gobernado por docs/04-contrato-del-cambio.md y ADR-010.
--
-- Esta migración define el MODELO. No implementa la transacción del cambio
-- (`pos.commit_exchange()`, que es C5) ni la interfaz (C6). Igual que H-35
-- preparó el terreno sin implementar cambios, aquí se crea el lugar donde
-- vivirán y se generaliza la autoridad del saldo para que pueda gobernarlos.
--
-- ── Por qué hace falta una costura de SUMINISTRO ────────────────────────────
-- H-35 dejó preparada la extensión del lado que RESTA: la vista
-- pos.line_consumption. Pero el lado que SUMA estaba fijo: el bloque `sold` de
-- pos.sale_line_balance() leía exclusivamente pos.sale_items del folio.
--
-- El contrato permite recambiar una pieza recibida en un cambio anterior y le
-- asigna valor histórico propio. Esa pieza no es renglón de ninguna venta, así
-- que sin un lado que sume no podría gobernarse: sería posible consumir dos
-- veces la misma unidad por caminos distintos, el defecto exacto que H-35
-- existe para prevenir.
--
--   vendida   = sale_items(folio)  ∪  line_supply(folio)
--   consumida = line_consumption(folio)
--
-- Una cadena A→B→C queda anclada al folio de origen y sigue habiendo UNA sola
-- autoridad del saldo (ADR-003).
--
-- Aditiva y retrocompatible: sin cambios registrados, line_supply está vacía y
-- el saldo es idéntico al de H-35. Ni pos.commit_sale() ni pos.commit_return()
-- se modifican.

-- ── 1) Documento de cambio ──────────────────────────────────────────────────
create table if not exists pos.exchanges (
  id                    text primary key,
  folio                 text not null,          -- referencia comercial propia (ADR-001)
  origen_folio          text not null,          -- FK lógica → pos.sales.folio
  fecha                 text,                   -- 'YYYY-MM-DD HH:MM', formato local del POS
  usuario               text,
  valor_reconocido      numeric(12,2) not null default 0,
  valor_entregado       numeric(12,2) not null default 0,
  diferencia            numeric(12,2) not null default 0,
  valor_no_aprovechado  numeric(12,2) not null default 0,
  base_comision         numeric(12,2) not null default 0,
  notas                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table pos.exchanges is
  'H-37: documento de cambio. Autonomo, con liquidacion economica propia (ADR-010). La venta origen conserva intacta su evidencia financiera.';
comment on column pos.exchanges.valor_no_aprovechado is
  'Sobrante que el cliente no consumio. El modulo de Cambios nunca devuelve efectivo.';
comment on column pos.exchanges.base_comision is
  'Excedente de valor sobre el que aplica la comision del segundo vendedor. El intercambio en si no genera comision.';

create table if not exists pos.exchange_items (
  id          bigint generated always as identity primary key,
  exchange_id text not null references pos.exchanges(id) on delete cascade,
  lado        text not null check (lado in ('devuelto', 'entregado')),
  sku         text,
  nombre      text,
  talla       text,
  qty         int not null check (qty > 0),
  precio      numeric(10,2) not null default 0,
  motivo      text
);

comment on column pos.exchange_items.lado is
  'devuelto = consume unidades de la venta origen; entregado = las suministra.';
comment on column pos.exchange_items.precio is
  'Valor historico de la pieza. En lado=entregado es el precio vigente aplicado, y desde ese momento es el valor reconocido de esa pieza.';

create index if not exists exchanges_origen_folio_idx on pos.exchanges (origen_folio);
create index if not exists exchange_items_exchange_idx on pos.exchange_items (exchange_id);

-- Mismo contrato de autorización que el resto del dominio (H-07 / H-08).
alter table pos.exchanges       enable row level security;
alter table pos.exchange_items  enable row level security;

drop policy if exists active_admin_all on pos.exchanges;
create policy active_admin_all on pos.exchanges
  for all to authenticated using (pos.is_active_admin()) with check (pos.is_active_admin());
drop policy if exists seller_pos_all on pos.exchanges;
create policy seller_pos_all on pos.exchanges
  for all to authenticated using (pos.is_active_seller()) with check (pos.is_active_seller());

drop policy if exists active_admin_all on pos.exchange_items;
create policy active_admin_all on pos.exchange_items
  for all to authenticated using (pos.is_active_admin()) with check (pos.is_active_admin());
drop policy if exists seller_pos_all on pos.exchange_items;
create policy seller_pos_all on pos.exchange_items
  for all to authenticated using (pos.is_active_seller()) with check (pos.is_active_seller());

revoke all on pos.exchanges      from anon;
revoke all on pos.exchange_items from anon;
grant select, insert, update, delete on pos.exchanges      to authenticated, service_role;
grant select, insert, update, delete on pos.exchange_items to authenticated, service_role;

-- ── 2) Costura de suministro ────────────────────────────────────────────────
-- Simétrica de pos.line_consumption: misma forma, signo opuesto.
create or replace view pos.line_supply as
  select e.origen_folio as sale_folio,
         ei.sku         as sku,
         ei.talla       as talla,
         ei.qty         as qty,
         'cambio'::text as origen,
         ei.exchange_id as documento
    from pos.exchange_items ei
    join pos.exchanges e on e.id = ei.exchange_id
   where ei.lado = 'entregado';

comment on view pos.line_supply is
  'H-37: unidades suministradas a una venta por documentos posteriores. Interna: solo service_role, con security_invoker.';

-- Interna y con la defensa de fondo, igual que line_consumption tras H-35: sin
-- security_invoker la vista se ejecutaria con los permisos de su dueño y evitaria
-- el RLS de exchange_items. El revoke nominal cierra el privilegio por defecto
-- del esquema pos, que concede toda relacion nueva a `authenticated` (AP-02).
alter view pos.line_supply set (security_invoker = true);
revoke all on pos.line_supply from authenticated;
revoke all on pos.line_supply from anon;
revoke all on pos.line_supply from public;
grant select on pos.line_supply to service_role;

-- ── 3) La autoridad del saldo suma también el suministro ────────────────────
-- Único bloque modificado respecto a 20260728004700: `sold` pasa de leer sólo
-- sale_items a unir el suministro. El resto —firma, exclusión por documento,
-- greatest, orden y grants— es idéntico.
create or replace function pos.sale_line_balance(
  p_folio text,
  p_exclude_document text default null
)
returns table (
  sku text,
  talla text,
  vendida integer,
  consumida integer,
  disponible integer
)
language sql
stable
security definer
set search_path = pos, pg_temp
as $balance$
  with supplied as (
    select si.sku, si.talla, si.qty
      from pos.sale_items si
     where si.folio = p_folio
    union all
    select ls.sku, ls.talla, ls.qty
      from pos.line_supply ls
     where ls.sale_folio = p_folio
       and (p_exclude_document is null or ls.documento is distinct from p_exclude_document)
  ),
  sold as (
    select s.sku, s.talla, sum(s.qty)::integer as qty
      from supplied s
     group by s.sku, s.talla
  ),
  used as (
    select lc.sku, lc.talla, sum(lc.qty)::integer as qty
      from pos.line_consumption lc
     where lc.sale_folio = p_folio
       and (p_exclude_document is null or lc.documento is distinct from p_exclude_document)
     group by lc.sku, lc.talla
  )
  select s.sku,
         s.talla,
         s.qty as vendida,
         coalesce(u.qty, 0) as consumida,
         greatest(s.qty - coalesce(u.qty, 0), 0) as disponible
    from sold s
    left join used u on u.sku = s.sku and u.talla = s.talla
   order by s.sku, s.talla;
$balance$;

comment on function pos.sale_line_balance(text, text) is
  'H-35/H-37: autoridad unica del saldo por renglon. vendida = vendido + suministrado por cambios; consumida = devuelto + entregado de vuelta.';

revoke all on function pos.sale_line_balance(text, text) from public;
revoke all on function pos.sale_line_balance(text, text) from authenticated;
revoke all on function pos.sale_line_balance(text, text) from anon;
grant execute on function pos.sale_line_balance(text, text) to service_role;

-- ── 4) El cobro de la diferencia entra al ledger único ──────────────────────
-- pos.sale_payments no tiene clave foranea hacia pos.sales: `folio` es una
-- relacion logica. La unica atadura estructural era el check de `tipo`, y se
-- amplia de forma aditiva. El pago del cambio usa el folio PROPIO del cambio:
-- usar el de la venta origen violaria el contrato y ademas pos.commit_sale()
-- borra por folio antes de reinsertar, de modo que un abono posterior de la
-- venta eliminaria el pago del cambio.
alter table pos.sale_payments
  drop constraint if exists sale_payments_tipo_check;
alter table pos.sale_payments
  add constraint sale_payments_tipo_check
  check (tipo in ('venta', 'anticipo', 'abono', 'liquidacion', 'cambio'));

comment on column pos.sale_payments.folio is
  'Folio del DOCUMENTO que origino el cobro: una venta (tipo venta/anticipo/abono/liquidacion) o un cambio (tipo cambio). H-37.';

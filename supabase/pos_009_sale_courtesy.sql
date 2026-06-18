-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  POS Balam — Migración 009: Cortesías (regalos / giveaways)                ║
-- ║  Una venta de cortesía se registra con total = 0 (no se cobró) y método    ║
-- ║  'Cortesía'. Aquí guardamos el VALOR REGALADO (lo que se habría cobrado)    ║
-- ║  para los reportes de "cuánto se ha regalado". Solo se llena en cortesías.  ║
-- ║  Idempotente: seguro de correr varias veces.                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table pos.sales add column if not exists valor_regalado numeric(12,2) not null default 0;

-- El método 'Cortesía' se administra como cualquier otro en pos.lookup(payment_method);
-- el seam (store.jsx) lo sincroniza solo. No hace falta ninguna tabla nueva.

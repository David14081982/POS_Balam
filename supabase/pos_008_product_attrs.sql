-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  POS Balam — Migración 008: atributos de catálogos personalizados (Fase 2) ║
-- ║  El admin puede crear catálogos nuevos en Configuración → Catálogos de      ║
-- ║  producto. El VALOR elegido por producto vive aquí, en un mapa jsonb         ║
-- ║  { kind: code }, p. ej. { temporada: 'VER25', coleccion: 'GALA' }.           ║
-- ║  Los catálogos del sistema (cat/manga/tela/color/cuello) NO usan esto:       ║
-- ║  conservan sus columnas propias. Idempotente: seguro de correr varias veces. ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table pos.products add column if not exists attrs jsonb not null default '{}';

-- Nota: las DEFINICIONES de los catálogos nuevos (nombre, elementos, orden, si van
-- en el SKU/alta) ya sincronizan por las tablas existentes: los elementos en
-- pos.lookup (genérica por kind) y los metadatos en pos.settings (fila '_catalogMeta').
-- No hace falta ninguna tabla nueva.

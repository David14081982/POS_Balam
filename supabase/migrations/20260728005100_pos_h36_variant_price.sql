-- H-36 · Precio general del artículo con excepciones por talla
--
-- El negocio necesita que, dentro del mismo SKU, ciertas tallas tengan un precio
-- comercial distinto. No es una promoción: es el precio normal de esa talla.
--
-- Forma elegida: un mapa de EXCEPCIONES sobre pos.products, replicando el patrón
-- que la propia tabla ya usa en `barcode_urls jsonb` = { talla: valor }.
--
--   {}            → todas las tallas valen `precio`. Estado de todo lo existente.
--   {"XL": 450}   → XL vale 450; el resto sigue valiendo `precio`.
--
-- La ausencia de una clave significa «vale el precio general», no «sin precio»;
-- un 0 explícito sí es un precio. Cambiar `precio` no mueve una excepción: una
-- excepción es un precio, no un recargo.
--
-- Aditiva y retrocompatible: la columna nace con default '{}' y ninguna fila
-- cambia de comportamiento. `pos.commit_sale` NO se toca — `pos.sale_items` ya
-- transporta precio, precio_base y precio_original de forma condicional y los
-- trata como valores opacos, así que la venta congela el precio de su talla sin
-- que la función necesite conocer este modelo.
--
-- Autorización: la columna queda protegida sin trabajo extra porque
-- pos.restrict_seller_product_update() compara `to_jsonb(new) - [claves
-- permitidas]` contra `to_jsonb(old) - [...]`: es una lista de exención por
-- sustracción, de modo que toda columna nueva entra protegida. Eso se PRUEBA en
-- la verificación 20260728005200, no se da por hecho.
--
-- Alcance: sólo esta columna y su restricción. No se toca ninguna función,
-- policy, trigger, índice ni dato existente.

alter table pos.products
  add column if not exists precios_talla jsonb not null default '{}'::jsonb;

comment on column pos.products.precios_talla is
  'H-36: excepciones de precio por talla, { talla: precio }. Vacio = todas las tallas valen products.precio. La ausencia de una clave significa precio general; un 0 explicito es un precio.';

-- Forma del mapa: objeto JSON, valores numéricos y no negativos. Se valida en la
-- base para que ninguna terminal —presente o futura— pueda dejar un precio
-- imposible dentro del catálogo.
alter table pos.products
  drop constraint if exists products_precios_talla_valid,
  add constraint products_precios_talla_valid check (
    jsonb_typeof(precios_talla) = 'object'
    and not exists (
      select 1
        from jsonb_each(precios_talla) as e(talla, precio)
       where jsonb_typeof(e.precio) <> 'number'
          or (e.precio)::numeric < 0
    )
  );

# ADR-013 · La referencia física usa products.id, barcode y SKU separados

**Estado:** decisión arquitectónica aceptada · implementación preparada
**Historia:** H-94 · **Fecha:** 10/08/2026

## Contexto

El modelo V1 concentra tallas en `stock[]` y deriva Code128 de `SKU+talla`.
Cuando dos combinaciones físicas comparten SKU, buscar la primera coincidencia
puede operar otra pieza. Crear además `variant_id` duplicaría la identidad ya
existente de `pos.products.id`.

## Decisión

Toda alta nueva usa el modelo V2: una combinación física, una fila `products`,
una talla y stock escalar. `products.id` es identidad técnica; `barcode_code` es
localizador logístico corto, estable y único; SKU es representación comercial
configurable. Un SKU repetido advierte, pero ID, barcode y firma física repetidos
bloquean. El escaneo nunca atraviesa SKU.

`EN REFERENCIA` gobierna la firma física y es independiente de `EN SKU`. Una vez
que existen referencias V2 no se redefine esa receta en sitio. Una combinación
usada se corrige moviendo cantidad entre IDs mediante reclasificación auditada,
atómica, idempotente y reversible; los documentos no se reescriben.

Las líneas modernas congelan identidad, barcode, SKU, atributos y dinero. Los
lectores V1 permanecen durante la transición, y `SKU+talla` sólo puede adoptar
historia cuando identifica exactamente un candidato. No se convierte inventario
V1 ni se inventa cómo repartir sus existencias.

## Despliegue y reversa

Primero se aplican migración y verificación del servidor; después se publica el
cliente con la versión de esquema exigida. Un servidor anterior bloquea las
escrituras V2. La reversa retira primero el cliente; la base aditiva se conserva
y cualquier corrección posterior se hace hacia adelante. Punto cero, carga real
e impresión de etiquetas son operaciones posteriores y separadas.

## Consecuencias

- V1 y V2 se leen en paralelo hasta el punto cero.
- El consolidado por modelo/talla es una proyección, nunca stock autoritativo.
- Barcode de 16 caracteres cabe en Code128 de 60×40; el valor no se imprime.
- Cambiar precio, promoción o descuento no cambia ninguna identidad.

## Referencias

`ADR-002` · `ADR-006` · `ADR-012` · `docs/02-architecture.md` · H-94

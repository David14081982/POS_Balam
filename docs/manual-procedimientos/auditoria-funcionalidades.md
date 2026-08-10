# Auditoría de funcionalidades documentables

Fecha de corte: 10 de agosto de 2026. La columna «Publicada» exige evidencia del artefacto servido, no sólo código local.

| Funcionalidad | Implementada | Publicada | Documentable |
|---|---:|---:|---:|
| Alta y edición de productos (UI H84) | Sí | Sí | Sí |
| Existencias masivas por talla | Sí | Sí | Sí |
| Ornamento y colores generales | Sí | Sí | Sí |
| Colores de ornamento por talla (H83) | Sí | Sí | Sí |
| Precios especiales por talla (H36) | Sí | Sí | Sí |
| Resumen efectivo por talla, sólo lectura (H84) | Sí | Sí | Sí |
| Constructor de SKU reconocible | Sí | Sí | Sí |
| Identidad interna independiente del SKU | Sí | Sí | Sí, sin exponer identificadores técnicos |
| Sufijos comerciales SKU `-01/-02/-03` | No | No | No; nota administrativa únicamente |
| Prevención de mezcla por SKU en Excel (H86) | Sí | Sí | Sí |
| Etiquetas Code128 60×40, imprimir/descargar/compartir (H88B) | Sí | Sí | Sí |
| Plantilla/Exportar/Importar bajo contrato único (H86) | Sí | Sí | Sí |
| Comisiones 3/4/5, meta y 120 %, marginales (H69) | Sí | Sí | Sí |
| Porcentaje personalizado, nivel y meta por vendedora (H69) | Sí | Sí | Sí |
| Reporte y cierre mensual de comisiones (H69) | Sí | Sí | Sí |
| Bono automático configurado | No | No | No; el campo vigente es informativo |

## Evidencia determinante

- H83: `docs/fixes/colores-ornamento-por-talla.md`, pruebas 32/32 y E2E 17/17, publicado.
- H84: `docs/fixes/redisenio-ui-nuevo-producto.md`, E2E 19/19 y bytes públicos verificados.
- H86: `docs/fixes/contrato-excel-inventario.md`, 37/37 también sobre bytes públicos.
- H88B: `docs/fixes/impresion-etiquetas-movil.md`, 19/19 local y público.
- H69: `docs/fixes/comisiones-de-vendedores.md`, política publicada 3/4/5/120, pruebas 88/88 y validación pública.
- Código vigente: `balam/inventory.jsx`, `balam/barcodes.jsx`, `balam/xlsx-io.jsx`, `balam/data.jsx`, `balam/settings.jsx`, `balam/sellers.jsx` y `balam/reports.jsx`.


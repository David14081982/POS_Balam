# Historial de correcciones

Un archivo por corrección conserva la causa y la evidencia más allá de una
sesión de chat.

## Cómo usar este directorio

- Antes de modificar un módulo, leer las correcciones relacionadas.
- Crear el documento desde `_template.md` durante la etapa de documentación.
- Usar nombres estables en minúsculas y con guiones.
- Enlazar el riesgo de `../03-known-risks.md`.
- No inventar commits, fechas ni resultados de pruebas.

## Correcciones registradas

| Archivo | Riesgo | Tema |
|---|---|---|
| `admin-users-auth.md` | H-05 | Autorización de usuarios mediante Edge Function |
| `concurrencia-multi-terminal.md` | H-06 | Versionado optimista, conflictos y tombstones |
| `rls-administrador-activo.md` | H-07 | Acceso al dominio sólo para administrador activo |
| `vendedor-solo-punto-venta.md` | H-08 | Administrador completo y vendedor sólo Punto de Venta |
| `inventario-concurrente.md` | H-01 | Reserva atómica e idempotente de stock por venta |
| `venta-transaccional-idempotente.md` | H-04 | Venta y devolución transaccionales e idempotentes |
| `folios-multi-terminal.md` | H-02 | Identidad inmutable y folios únicos offline |
| `aislamiento-cola-por-sesion.md` | H-09 | Cola offline aislada por identidad |
| `migraciones-reproducibles.md` | H-10 | Cadena formal y contrato de esquema |
| `margen-minimo-promociones.md` | H-11 | Piso de margen en promociones |
| `lector-excel-seguro.md` | H-12 | Dependencia Excel fijada y lectura con límites |
| `recuperacion-movimientos-terminal.md` | H-13 | Reconstrucción del kardex desde Supabase |

Documentación financiera relacionada, creada antes de este índice:

- `../H-03-coherencia-cobro.md`
- `../trazabilidad-financiera.md`

Cuando H-03 vuelva a modificarse, su nuevo documento de corrección debe crearse
en este directorio; los documentos anteriores se conservan como evidencia.

# Simplificación de Limpiar datos de prueba

**Riesgo:** H-117
**Estado:** RESUELTO — CLIENTE LISTO PARA PUBLICAR
**Fecha:** 19/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

La pantalla publicada de Configuración → Administración / Datos presenta antes
de la limpieza normal una tarjeta destructiva de Punto Cero con 24 conteos,
tres presets —incluido Punto Cero otra vez—, ocho grupos con descripciones
técnicas, un preview llamado «plan», estados por terminal y dos acciones finales.
El preview ya se recalcula con debounce al cambiar selección, por lo que
«Actualizar plan» duplica una capacidad vigente. El botón principal puede
quedar deshabilitado sin una explicación positiva cuando todo está listo.

### Auditoría previa

| Elemento publicado | Clasificación | Evidencia |
|---|---|---|
| Modo preproducción | NECESARIO | Define si la capacidad está disponible |
| Tarjeta/preview Punto Cero antes del flujo normal | DESTRUCTIVO / CONFUSO | Comparte título y jerarquía con la limpieza selectiva |
| Presets Punto Cero, Operaciones y Personalizada | DUPLICADO / CONFUSO | Las casillas y el preview automático ya expresan el alcance |
| Casillas por grupo comercial | NECESARIO | Son la entrada semántica de H-113 |
| Descripciones de commits, products.id y evidencia | TÉCNICO | No ayudan al dueño a elegir |
| Se eliminará / se conservará | NECESARIO | Explican el resultado antes de confirmar |
| Stock actual → stock después | NECESARIO / CONFUSO | Suma sólo referencias afectadas, no todo el inventario |
| Dependencias crudas | TÉCNICO | Expone tokens internos del preview |
| Estado de equipos | NECESARIO | Consume la autoridad H-116 |
| Protocolo, esquema y época | TÉCNICO | Ya están bajo detalle colapsable |
| Actualizar plan | DUPLICADO | El efecto de selección ya dispara preview a los 180 ms |
| Revisar y continuar | CONFUSO | No nombra la acción final esperada |
| Respaldo, frase y advertencia final | NECESARIO | Son puertas vigentes y no se retirarán |

## Causa raíz

La UI conserva simultáneamente el modelo de implementación de H-113 —preset,
plan, dependencias y estados técnicos— y el modelo de tarea del usuario. La
autoridad remota es correcta; la primera capa incorrecta es la proyección en
`SelectiveCleanupCard` y el orden visual de `AdminDataPanel`.

## Diseño

Se reutilizan sin cambios el preview, selección normalizada, stock, flota,
respaldo, confirmación y ejecución existentes. La pantalla mostrará siempre las
siete selecciones comerciales, recalculará automáticamente, traducirá
dependencias, inventario y equipos, y dejará una única acción principal. Punto
Cero conservará su contrato H-98 en una tarjeta separada y posterior.

## Solución

- `SelectiveCleanupCard` muestra directamente siete opciones comerciales, sin
  presets ni selección de tablas. Todas parten desmarcadas.
- El preview conserva su debounce de 180 ms y ahora descarta respuestas
  obsoletas; se retiró el botón «Actualizar plan».
- El resultado traduce dependencias, conteos, piezas que regresan/salen, cambio
  neto y antes/después limitado explícitamente a referencias afectadas.
- «Ver detalle» resuelve nombre, SKU y talla desde `products.id` sólo para
  presentación; el UUID nunca se imprime y no participa en decisiones.
- La flota se resume en listas, apagadas, actualizables y atención. Estado,
  protocolo, esquema y época quedan bajo «Ver detalle técnico».
- Existe una única acción «Continuar con la limpieza» y siempre tiene encima
  un estado humano de disponibilidad o bloqueo.
- Punto Cero se movió después del flujo normal, se tituló inequívocamente y
  mantiene intactos diagnóstico, respaldo, frase, RPC y ejecución H-98.
- El wizard conserva sus cinco puertas, pero elimina «preview autoritativo»,
  «plan», «identidades selladas», «transacción» e «idempotente» del lenguaje
  principal. El identificador queda bajo detalle técnico.

## Pruebas

La prueba roja H-117 produjo 6 fallos y 1 aprobación contra el bundle publicado
anterior. Después de la corrección:

- H-117 A–H: 65/65; venta, venta+apartado, devolución, cambio, préstamo, mezcla,
  equipo apagado seguro y operación intersectante. Los siete casos ejecutables
  recorren selección → preview → respaldo → confirmación → fixture local →
  reload, con conteos en cero e inventario objetivo exacto. H no ejecuta.
- Responsive: 320, 360, 375, 390, 430, 768, 1024, 1280 y 1440 px sin overflow;
  revisión visual móvil/escritorio sin truncamiento ni CTA tapado.
- H-116 contrato 20/20 y UI 26/26; H-113 contrato 35/35 y UI 21/21.
- H-98 contrato 24/24, E2E 18/18 y diagnóstico 9/9.
- Navegación 15/15; roles 15/15; smoke bundle 17/17; módulos 42/42;
  migraciones 31/31; reproducibilidad 8/8; build final correcto.
- No se usó Supabase ni se ejecutó ninguna limpieza real.

## Riesgo residual y pendientes

El preview H-113 sólo contiene stock de referencias afectadas; por seguridad la
UI no presenta esos subtotales como inventario total de la tienda. Punto Cero
conserva su diagnóstico detallado visible porque es una guarda contractual H-98
y no forma parte del recorrido normal.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-117--limpiar-datos-de-prueba-expone-el-modelo-técnico`
- `docs/fixes/limpieza-selectiva-datos-prueba.md`
- `docs/fixes/limpieza-h113-riesgo-real-equipos.md`

# Autoridad de mensajes humanos

**Riesgo:** H-134
**Estado:** RESUELTO
**Fecha:** 29/08/2026
**Commit:** `b84a633`

## Problema y reproducción

Los mensajes visibles no tenían una autoridad común. Un error remoto, una
excepción o un diagnóstico podía llegar sin traducción a una notificación, un
bloqueo, la campana o una sección de Configuración. La revisión base encontró
333 superficies de comunicación y 36 exposiciones de vocabulario técnico.

La reproducción se hizo recorriendo las pantallas, buscando consumidores de
errores crudos y forzando respuestas de permisos, sesión, red, servicio,
compatibilidad, conflicto, datos, almacenamiento, etiquetas y archivos. El
resultado esperado era siempre explicar qué ocurrió y qué puede hacer la
persona, sin exigirle conocer la implementación.

## Causa raíz

`UI.ToastHost` renderizaba directamente cadenas y objetos recibidos. Además,
varios consumidores imprimían por su cuenta `error`, `message`, diagnósticos y
razones internas. Al no existir un límite común de presentación, cada módulo
decidía su texto y cualquier error nuevo podía atravesar la interfaz sin
clasificación ni traducción.

## Diseño

`UI.messageAuthority` es la autoridad única que convierte una condición en:
título, explicación, acción, nivel y detalle técnico opcional. `HumanMessage`
presenta el mismo contrato dentro de la página y `ToastHost` lo aplica a toda
notificación, incluso cuando el consumidor todavía entrega un valor remoto.

Las invariantes son:

- el mensaje principal describe el problema y una acción concreta;
- ningún valor remoto o excepción se imprime directamente;
- el detalle técnico permanece cerrado por defecto y sólo existe para
  administración o soporte;
- vendedores nunca reciben ese detalle;
- la clasificación no cambia permisos, reglas comerciales, persistencia,
  identidades, documentos, sincronización ni datos históricos.

## Solución

Se agregó el catálogo central y se migraron los mensajes de acceso, venta,
inventario, etiquetas, devoluciones, cambios, apartados, préstamos, clientes,
reportes, configuración, equipos, actualización, trabajo sin conexión, Excel,
impresión y generación de documentos.

| Antes | Ahora | Acción ofrecida |
|---|---|---|
| Error de seguridad del servidor | No tienes permiso para realizar esta acción | Solicitar acceso a administración |
| Caché interna del servicio no disponible | El servicio necesita mantenimiento | Reportarlo a soporte y volver a intentar después |
| Protocolo del equipo desactualizado | Este equipo necesita actualizarse | Abrir el Centro de equipos |
| Código ambiguo; resincroniza | El código identifica más de un producto | Buscar el artículo por nombre y pedir una revisión |
| Densidad o ancho técnico insuficiente | La etiqueta queda demasiado apretada | No imprimir y corregir el contenido |
| Archivo con estructura o identidad interna incompatible | El archivo no tiene el formato esperado | Descargar una plantilla nueva |
| Almacenamiento o cola local sin garantía | Hay poco espacio para guardar cambios | Liberar espacio y no cerrar la aplicación |
| Error remoto desconocido | El servicio no respondió como esperábamos | Volver a intentar; si continúa, reportarlo |

El detalle exacto se conserva para diagnóstico detrás de “Detalles técnicos”,
cerrado por defecto, únicamente cuando el rol es administrador o soporte.

## Pruebas

- `node test-h134-human-messages.mjs`: 43/43; 333 superficies, 36 técnicas
  base, 36 reescritas y 0 actuales.
- `node test-h134-human-messages-e2e.mjs`: 26/26 en 11 pantallas, todas las
  secciones de Configuración y errores remotos inyectados.
- `node test-responsive-ui.mjs`: 492/492.
- `node test-ui-navigation.mjs`: 15/15.
- `node test-h109-mobile-checkout-toast.mjs`: 10/10 en anchos de 320 a 430 px.
- `node test-login-visible-error.mjs`: 8/8.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-store-queue.mjs`: 186/186.
- `node test-sale-coherence.mjs`: 20/20.
- `node test-returns.mjs`: 21/21.
- `node test-loans-screen.mjs`: 117/117.
- `node test-layaway-screen.mjs`: 55/55.
- `node test-exchange-screen.mjs`: 45/45.
- `node test-h89-pwa.mjs`: 19/19.
- `node test-h86-inventory-xlsx-contract.mjs`: 42/42.
- `node test-xlsx-security.mjs`: 17/17.
- `node test-h127-label-diagnostics.mjs`: 11/11.
- `node test-h132-inventory-identity-certification.mjs`: 7/7.
- `node test-h133-inventory-v3.mjs`: 8/8.
- `node test-build-reproducibility.mjs`: 8/8.
- `node build-offline.mjs`: correcto; 72 recursos, 9.03 MB.

## Riesgo residual y pendientes

Ninguno conocido para H-134. Las pruebas de hardware físico de impresora y
lector pertenecen al riesgo heredado H-133; esta corrección sólo cambia la
comunicación visible y no amplía aquella certificación.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-134--mensajes-operativos-exponen-implementación-en-lugar-de-orientar`
- Metodología: `docs/01-engineering-methodology.md`
- Flujo arquitectónico: `docs/architect/WORKFLOW.md`

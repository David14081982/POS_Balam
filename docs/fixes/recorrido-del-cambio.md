# El recorrido del cambio cobraba al cajero lo que ya sabía

**Riesgo:** H-44
**Estado:** RESUELTO
**Fecha:** 29/07/2026
**Commit:** `9e8e5bc`

## Problema y reproducción

Precondición: la pantalla del cambio existe y funciona desde H-42 (C6), y desde
H-43 hay un instrumento que mide su recorrido.

    node test-ux-metrics.mjs

Resultado antes del cambio: **14 interacciones** —9 clics, 4 capturas de texto,
1 menú— y **1 validación de negocio** atravesada, en 9.4 s.

Tres de esas catorce eran datos que el sistema ya conocía o podía proponer:

| paso | qué se le pedía al cajero | qué sabía el sistema |
|---|---|---|
| 4 | declarar «Cambio» tras elegir la venta | lo declaró en el cambio anterior |
| 6 | abrir el menú y elegir el motivo | el motivo del cambio es la talla casi siempre |
| 10 | escribir quién revisó la mercancía | quién tiene la sesión abierta |

Además, con la pantalla a medio llenar el botón principal quedaba
**deshabilitado sin decir qué faltaba**, y el aviso del sobrante que el cliente
pierde se daba con `window.confirm`.

## Causa raíz

Ninguna regla del negocio estaba mal. El defecto era de **orden y de silencio**:

1. La operación se declaraba *después* de localizar la venta, así que la
   pantalla anterior no podía hablar en el idioma de lo que se iba a hacer y el
   cajero llegaba a una pantalla de devolución para hacer un cambio.
2. Cada campo empezaba vacío aunque su valor más frecuente fuera conocido. Un
   formulario que no propone nada obliga a repetir lo de siempre.
3. El botón deshabilitado trasladaba al cajero la tarea de deducir el requisito
   que faltaba, información que la pantalla ya tenía.
4. `window.confirm` no sabe pintar una cifra, no distingue la acción destructiva
   de la que sigue y congela la pantalla mientras el cliente pregunta.

## Diseño

**Preseleccionar no es decidir por el cajero.** El límite es la visibilidad: un
valor propuesto se lee en su propio control y se corrige con un toque. Un valor
inyectado que el cajero no puede ver es una decisión tomada en su nombre y
firmada con su usuario. Por eso el motivo llega marcado **en el desplegable** y
la condición **en el campo de texto**, no en una variable interna.

**La guía informa; no autoriza.** `validar()` sigue siendo la única autoridad
que decide si un cambio se registra. El botón habilitado no relaja ninguna
comprobación: la hace *alcanzable*, y por tanto comprobable. Solo el plazo
vencido lo deshabilita, porque ahí no hay nada que guiar —la venta ya no admite
posventa y quien lo resuelve es un administrador en Configuración—.

**La operación recordada es preferencia del dispositivo, no dato del negocio.**
Vive en `localStorage`, su pérdida no cuesta nada y no viaja a la nube. Por eso
el selector del detalle **sobrevive como corrección**: recordar mal no puede
obligar a empezar de nuevo.

**Compatibilidad.** El flujo de Devoluciones no cambia una línea: `ReturnDetail`
queda intacto y el selector del detalle conserva su contrato. `Segment` gana un
`testid` opcional, aditivo e inerte en producción.

## Solución

`balam/returns.jsx`

- `OP_KEY` / `ultimaOperacion()` / `recordarOperacion()`: memoria de la última
  operación declarada.
- `ReturnsScreen`: `tipo` se inicializa desde la memoria y persiste al cambiar;
  `volver()` ya no la reinicia.
- `ReturnPicker`: bloque «Qué vas a registrar» **antes** del buscador, con la
  consecuencia escrita («no se devuelve efectivo»); el encabezado y el icono
  siguen a la operación elegida.
- `ExchangeDetail`: `motivoDefault` y `CONDICIONES`; `setRow` siembra los valores
  por defecto al abrir el renglón y **nunca pisa lo ya escrito**; el revisor
  arranca con la sesión; cuatro acciones rápidas de condición; `guia` y el botón
  que la enuncia; `aviso` con el modal del sistema.
- Contratos estables nuevos: `operacion-<tipo>`, `operacion-detalle-<tipo>`,
  `cambio-motivo`, `cambio-condicion`, `cambio-condicion-rapida`,
  `cambio-revisor`, `cambio-aviso-confirmar`, `cambio-aviso-revisar`.

`balam/shared.jsx` — `Segment` acepta `testid` y estampa `<testid>-<id>` por
opción, porque su texto se pinta en mayúsculas por CSS (`R-DEL-10`).

`test-ux-metrics.mjs` — el escenario recorre el camino nuevo; segunda validación
instrumentada; `window.__pausa` para sondear defensas sin contarlas; escenario
`cambio-de-talla-repetido`; sesión abierta en la semilla (`R-DEL-12`).

## Pruebas

Guardián de `R-DEL-14`, **en verde sin intervención manual**:

    ══ GUARDIÁN · comparación contra la línea base ══════════════
      ✅ validaciones             base 1      ahora 2
      ✅ recorrido completo       base true   ahora true
      ✅ interacciones            base 14     ahora 11

      ✔ mejora real: −3 interacciones sin perder garantías

Las dos columnas, leídas juntas: el coste bajó de 14 a 11 y las garantías
ejercidas subieron de 1 a 2. La validación nueva comprueba que **la revisión de
la prenda sigue siendo obligatoria aunque llegue preseleccionada** —vaciada,
bloquea; restaurada, libera—, que es precisamente el riesgo que la preselección
introducía.

Escenario `cambio-de-talla-repetido` —segundo cambio del turno, operación
recordada—: **10 interacciones**, 2 validaciones, recorrido completado.

El escenario oficial se reejecutó **después** del repetido y siguió midiendo 11
interacciones y 2 validaciones, con `ux-baseline.json` intacto —SHA-256
`0e5f1b52f3b0a9d34c38db487844787b76da49a3b3329889569916d2f3ca6ebe` antes y
después—: el escenario nuevo no altera el oficial ni reescribe la línea base.

**Nota para quien lo reejecute:** al cerrar la historia la línea base se refijó a
`11 / 2` (`R-DEL-16`), así que una corrida posterior imprime `base 11 ahora 11` y
ya no la línea de mejora. La comparación de arriba es la que decidió el cierre;
la base nueva es la que protege el terreno ganado.

Dos hallazgos del propio guardián durante la implementación:

1. Falló por `recorrido completo` en rojo. Causa: sin sesión abierta el revisor
   no se prellena, así que el recorrido se detenía en «Falta quién revisó». La
   semilla no representaba un estado válido del negocio (`R-DEL-12`): nadie
   opera el mostrador sin identificarse.
2. La comprobación 17 de `test-exchange-screen.mjs` seguía en verde tras retirar
   `window.confirm`, porque su expresión casaba con la **mención** en un
   comentario nuevo. Se ajustó a `window\.confirm\(` —el paréntesis distingue la
   llamada de la mención— y a los contratos del modal. Es `AP-11` en su forma de
   falso positivo.

Arneses: E2E del cambio **34/34** (seis comprobaciones nuevas: declaración
previa, aterrizaje directo, memoria, botón guía, preselección visible y
editable); pantalla del cambio **42/42**; devoluciones 17/17; plazo 38/38; saldo
por renglón 38/38; modelo del cambio 28/28; commit del cambio 32/32; apartados
55/55; ticket 23/23; precio por talla 38/38 y su E2E 19/19; coherencia de venta
17/17; contratos de módulo 37/37; migraciones 31/31; roles 10/10; build 8/8;
smoke 15/15; navegación 14/14; reproducibilidad 8/8.

Sin migraciones: H-44 no toca esquema, contrato, autoridades ni reglas
económicas.

## Despliegue (`R-DEL-07`)

El artefacto servido por GitHub Pages en
`https://david14081982.github.io/POS_Balam/index.html` se descargó y se comparó
byte a byte contra el `index.html` del commit `9e8e5bc`. Coinciden:

    SHA-256  ddfe83aafb1b568a80870bf274e658776596bd18c580898e9234c1099132e93a
    bytes    8 689 063

## Riesgo residual y pendientes

- `window.confirm` sigue vivo **fuera** de esta pantalla: clientes, promociones,
  vendedores y configuración. H-44 no lo tocó porque su alcance era el cambio.
  Queda como **deuda técnica con historia propia** —estandarizar los diálogos
  del sistema—, y no es cosmética: varios de esos avisos son destructivos
  (eliminar un cliente, regenerar SKU, cerrar periodo) y el navegador no
  distingue la acción destructiva de la que sigue. El inventario se obtiene del
  repositorio: `grep -rn "window.confirm(" balam/*.jsx`.
- La condición de la prenda sigue siendo texto libre con atajos, no un catálogo
  administrable por el administrador.
- El catálogo de la pantalla lista los primeros 24 artículos filtrados, sin
  paginación (heredado de H-42).
- H-45 —camino rápido para el cambio de talla— y C7 siguen abiertos.

## Referencias

`docs/04-contrato-del-cambio.md` · `docs/architect/playbooks/delivery.md`
(`R-DEL-10` a `R-DEL-15`) · `docs/architect/PHILOSOPHY.md` principio 9 ·
`docs/fixes/pantalla-del-cambio.md` · `ux-baseline.json`

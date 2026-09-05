# Salida Android y ajuste de ancho en RawBT

**Riesgo:** H-146
**Estado:** CORREGIDO Y VALIDADO — PUBLICACIÓN PENDIENTE
**Fecha:** 05/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Desde `d9d134f`, el usuario confirma letras oscuras con el botón principal,
un enlace «Impresión del sistema» sin respuesta y margen lateral derecho.
No conoce el ancho configurado en RawBT. Se trabaja en worktree aislado.

## Causa raíz

La ayuda Android ofrece un segundo transporte (`host.print()`) diferente del
intent funcional del botón principal. El test previo sólo contaba llamadas a
una función simulada: no demostraba apertura de la impresión nativa.
La evidencia física del usuario demuestra que esa alternativa no le sirve.

El ancho del PNG H-145 es 576 puntos con 571 de tinta, sin el margen derecho
reportado en papel. RawBT documenta que imprime imágenes al ancho de sus
ajustes. Es una hipótesis pendiente de confirmar en la tablet, no una causa
física demostrada. No agrandar a ciegas el PNG ni emitir comandos nuevos.

## Diseño

Conservar una única acción visible de impresión Android: el botón principal
ya funcional. La ayuda indica el ancho para rollo de 80 mm en RawBT (576 puntos).
Los errores de recursos/longitud ofrecen reimpresión desde computadora, donde
el transporte nativo y PDF están comprobados. No ofrecer un enlace inoperante.

| Capacidad/ciclo | Contrato |
|---|---|
| Venta exitosa, reimpresión y Reportes | Botón principal con gesto y PNG idéntico |
| Apartados, cambios y devoluciones | Ayuda compartida, misma salida |
| V1/V2, largo/corto | Sin alterar datos, raster ni altura |
| Error, reintento, cierre, offline | Mensajes verdaderos y sin envío tardío |
| Escritorio/PDF | Impresión nativa intacta |
| Roles, identidad, persistencia, cola y reversas | No cambia negocio ni exige SQL |

## Solución

`ReceiptPrintHelp` elimina el enlace secundario y muestra la instrucción de
ancho. Reportes utiliza el mismo texto compartido dentro de las herramientas,
ocultas al imprimir. La salida PNG y el botón principal no cambian. Los errores
de preparación ya no remiten a una opción retirada. Se conserva la API nativa
para escritorio; no se infiere soporte Android de su mera existencia.

## Pruebas

Rojo H-143: 35/39; fallan exactamente las cuatro comprobaciones nuevas de
ausencia del enlace y presencia de ayuda en comprobantes y Reportes.
Verde del bundle final: 39/39. Incluye ayuda y botón dentro del viewport
en 320, 360, 390, 430, 768, 1024, 1280 y 1440 px.
Regresiones: `node test-h144-ticket-design.mjs` 61/61;
`node test-smoke.mjs bundle` 17/17; `node test-ui-navigation.mjs` 15/15;
`node test-h90-payment-method-ticket-e2e.mjs` 21/21;
`node test-build-reproducibility.mjs` 8/8. Los siete PNG de los escenarios
H-144 coinciden byte a byte con H-145: este cambio no altera el ticket.
El recorrido H-143 ejerce Reportes → reimpresión → cierre →
ticket por método → POS → cobro → vendedor → venta exitosa → impresión,
además de Apartados. El ancho físico requiere la impresora del usuario.

BALAM QA: inspección de las capturas de venta exitosa en tablet y reimpresión
confirma textos completos, botón accesible y ausencia del enlace inoperante.
No se cambian reglas de negocio, permisos, SQL, cola, identidad, históricos,
Excel ni etiquetas. La preparación/reintento y el PNG siguen en la autoridad
compartida. La salida de escritorio y las ventanas independientes conservan
su contrato. No se midió Android nativo; se intercepta el intent con gesto real
en Chromium para evitar impresiones y escrituras comerciales durante las pruebas.

Dos builds idénticos, SHA-256 local
`0fecb93f0fdcee0efc0a9a7dd1ebaa8a35a9157788fcefad1df243d59d7ec99c`.

## Riesgo residual y pendientes

El 05/09/2026, después de orientar el ancho en RawBT, el usuario confirma
«QUEDÓ PERFECTO» y pide guardar los cambios. Se registra aceptación de la
impresión física, sin atribuir un valor de configuración no leído en la tablet.
BALAM no puede leer ni cambiar los ajustes de RawBT desde el navegador.
No quedan fallos reportados; la publicación de la ayuda está pendiente.

## Referencias

- `ancho-contraste-ticket-android-h145.md`.
- `impresion-android-rawbt-h143.md`.
- [RawBT: ancho aplicado por el controlador](https://rawbt.ru/faqs.html).

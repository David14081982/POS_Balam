# Revalidación del corte y contraste del ticket

**Riesgos:** H-135 y H-145.
**Estado:** SOFTWARE PUBLICADO REVALIDADO; INCIDENCIA FÍSICA ACTUAL PENDIENTE.
**Fecha:** 09/09/2026.
**Commit auditado:** `efcec1218ecc70b91a8158adf9e7aedc5a2987ac`.
**Commit de este registro:** Pendiente de commit.

## Problema y reproducción

El usuario aporta fotos con texto tenue y restos del pie al inicio del siguiente
ticket. La carpeta original estaba en `dc74757` con modificaciones preexistentes;
se creó un worktree independiente y se avanzó por fast-forward hasta origin/main.
No se alteró la carpeta original. El usuario autorizó posteriormente guardar
y subir el registro y sus mediciones; no incluye cambios de aplicación.

Las correcciones H-135 y H-145 ya están en la versión publicada. No se atribuye la
incidencia actual al controlador, al hardware ni a una versión antigua sin saber
qué dispositivo, transporte y versión produjeron los tickets fotografiados.

## Causa raíz

La causa histórica del PDF dividido es la dimensión inválida `80mm auto`; H-135
la sustituyó por altura medida. La causa histórica del raster tenue son los
grises; H-145 binariza la imagen Android. Ambas correcciones se comprobaron en
la publicación actual. La causa del reporte físico actual sigue sin determinar.

## Diseño y alcance

Auditoría de lectura con fixtures aislados. Comparar el artefacto servido contra
Git, ejecutar la regresión PDF y medir la salida gráfica Android. Conservar
ventas, stock, pagos, identidad V1/V2, cola, permisos y configuración productiva.
No hacer otra corrección antes de localizar la primera capa incorrecta.

## Solución / resultado

No se modificó código productivo. El PDF actual ofrece una página de 80 mm y
altura variable. Android/RawBT recibe una imagen de 576 puntos, exclusivamente
blanca/negra. La impresión nativa de escritorio conserva los colores de su
plantilla: la binarización pertenece al transporte Android.

## Pruebas

- `node test-h135-continuous-ticket.mjs https://david14081982.github.io/POS_Balam/?audit=20260909`:
  **61/61**, salida 0. Dieciséis PDF; largo de 24 prendas de 1006.09 mm en una
  página; corto posterior de 299.13 mm; ocho viewports, reimpresión y desmontaje.
  Evidencia: `evidence/ticket-audit-20260909-pdf.json`.
- H-144 sin adaptación interrumpe tras ocho controles correctos: su fixture
  intenta `CONFIG.setSetting` sin sesión lista. La guarda actual rechaza esa
  escritura. No se interpreta como fallo de impresión ni se altera la guarda.
- Copia temporal `.audit-h145-design.mjs`: reemplaza solamente la escritura del
  logo por una lectura `CONFIG.get` con fixture en memoria. Conserva generación
  y transporte productivos; mediciones conservadas en
  `evidence/ticket-audit-20260909-raster.json`: siete imágenes,
  576 puntos de ancho, 571 de tinta, cero píxeles grises, diferencia de altura
  menor de 3 puntos y paridad raster dentro del umbral del arnés. No se registra
  un conteo global de esta corrida porque su salida completa no se conservó.
- BALAM QA: inspección visual del PNG histórico; texto, importes y pie completos.
  No equivale a impresión física ni a Android nativo.
- HTTP 200, **9,051,998 bytes**, iguales byte a byte al blob `origin/main:index.html`.
  SHA-256 `38978740c0ba3295e4dab4e37dd03fdb90e686467af4b5f606059b1332f4f586`.
  Evidencia: `evidence/ticket-audit-20260909-public.json`.

## Riesgo residual y pendientes

Identificar modelo de impresora, dispositivo, navegador/transporte y papel
seleccionado de las fotografías; comprobar una reimpresión física del mismo
folio con la versión actual. No registrar ventas de prueba reales. El avance y
corte no se certifican con una imagen o PDF. No se probó Firefox/WebKit.
No hay nuevo build, migración ni commit de aplicación en esta revisión.
La publicación de este registro conserva los mismos bytes de la aplicación.

## Referencias

- `ticket-termico-continuo-h135.md`.
- `ancho-contraste-ticket-android-h145.md`.
- `salida-android-ancho-rawbt-h146.md`.
- `docs/03-known-risks.md`, H-135 y H-145.

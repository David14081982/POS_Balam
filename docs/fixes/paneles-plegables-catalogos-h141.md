# Paneles plegables en Catálogos de productos

**Riesgo:** H-141.
**Estado:** RESUELTO LOCALMENTE; pendiente de publicación.
**Fecha:** 05/09/2026.
**Commit:** Pendiente de commit.

## Problema y reproducción

Los contenedores de Configuración → Catálogos de productos muestran todo su
contenido al entrar. El usuario solicita que cada tema sea plegable. Contra el
artefacto anterior `6ba9858`, el recorrido H-141 obtiene 0/2: no existen paneles.

## Causa raíz

Los componentes de `balam/settings.jsx` renderizaban tarjetas estáticas. Es una
mejora de presentación solicitada, sin defecto atribuido a los datos.

## Diseño

Cada cabecera conserva título y contador disponible, añade flecha y permite
abrir/cerrar con ratón o teclado. Todos empiezan cerrados y se abren de forma
independiente. El contenido permanece montado para conservar borradores;
abandonar la sección y reingresar reinicia la apertura. Las acciones y campos
editables quedan dentro del panel, separados del control de apertura.

## Solución

`CatalogPanel` utiliza `details/summary` nativos dentro de `GlassCard`. Se aplica
a los seis temas auxiliares y a todos los editores de catálogos de productos,
incluidos los personalizados. El editor reutilizado por otras secciones mantiene
su presentación anterior. El nombre editable recibe una etiqueta explícita.
El cuerpo permite desplazamiento horizontal cuando su contenido lo necesita.

No se modifican reglas de negocio, persistencia ni sincronización. Abrir/cerrar
no escribe configuración. La edición de valores existentes conserva su guardado
habitual al salir del campo. No se ejecuta regeneración de SKU ni SQL.
Artefactos generados con `node build-offline.mjs`.

## Pruebas

- `node test-h141-catalog-panels.mjs --entry-ref=6ba9858`: rojo **0/2**.
- `node test-h141-catalog-panels.mjs`: **22/22**; apertura independiente,
  borradores, contenido montado, rerender, teclado, edición existente, reingreso,
  otras secciones y ausencia de excepciones. Configuración/productos idénticos
  tras plegar/desplegar, cero regeneraciones. Cabeceras a 320/360/390/768/1280 px.
  Capturas móvil/escritorio inspeccionadas; evidencia temporal
  `C:/Users/david/AppData/Local/Temp/balam-h141-zPgslW`.
- `node test-h63-e2e.mjs`: **58/58**, edición e importación con guardas vigentes
  sobre HTTP y archivo offline. El arnés abre los tres paneles que utiliza.
- `node test-h94-config-target.mjs`: **30/30**.
- `node test-smoke.mjs bundle`: **17/17**.
- `node test-ui-navigation.mjs`: **15/15**.
- `node test-build-reproducibility.mjs`: **8/8**.
- Self-review del diff y `git diff --check`: sin defectos pendientes.

Los recorridos usan datos aislados y bloquean la red comercial.

## Riesgo residual y pendientes

Pendiente: commit, publicación, comparación del artefacto servido y QA publicado.
Sin riesgos funcionales conocidos en el alcance probado. Los borradores se
conservan al plegar, no se promete conservarlos al abandonar la sección.

## Referencias

- `docs/03-known-risks.md`, H-141.
- `balam/settings.jsx`, `CatalogPanel`, `CatalogEditor`, `PANELS.producto`.
- `test-h141-catalog-panels.mjs`, `test-h63-e2e.mjs`.

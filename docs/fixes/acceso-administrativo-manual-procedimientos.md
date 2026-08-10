# Acceso administrativo al Manual de procedimientos

**Riesgo:** H-92  
**Estado:** RESUELTO — pendiente de publicación  
**Fecha:** 10/08/2026  
**Commit:** Pendiente de commit

## Problema y evidencia

El PDF oficial estaba entregado en la raíz del proyecto, pero BALAM no ofrecía una ruta visible para abrirlo o descargarlo. Crear `config.manual` como permiso nuevo habría dejado la sección denegada hasta sincronizar el catálogo remoto.

## Diseño y solución

Se añadió `ProceduresManualCard` dentro del panel ya autorizado `Configuración → Negocio`. La tarjeta tiene una única ruta al PDF oficial y dos acciones: abrir en pestaña separada con `noopener noreferrer`, y descargar conservando el nombre del documento. No se añadió pantalla ni permiso, no se tocaron datos ni Supabase.

El PDF queda como archivo publicable junto a `index.html`. El artefacto offline conserva la interfaz; para abrir el documento desde una copia descargada, el PDF debe acompañar al HTML en la misma carpeta.

## Pruebas

- `node test-h92-manual-procedimientos-admin.mjs`: 10/10.
- `node test-screen-registry.mjs`: 12/12.
- `node test-permission-admin-ui.mjs`: 21/21.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-ui-navigation.mjs`: 15/15.
- `node test-build-reproducibility.mjs`: 8/8.
- `node build-offline.mjs`: artefactos regenerados correctamente.

## Riesgo residual

La publicación web debe incluir el PDF raíz además de `index.html`. Una copia aislada de `POS Balam (offline).html` no puede abrir un archivo que no fue copiado junto a ella.

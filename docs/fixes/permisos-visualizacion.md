# Permisos de visualización por usuario

**Riesgo:** H-56
**Estado:** PARCIALMENTE RESUELTO - FASE 1
**Fecha:** 30/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Las pantallas principales se declaraban tres veces en `balam/app.jsx`: menú,
títulos y render. Configuración mantenía una cuarta lista para sus secciones.
Una pantalla nueva podía quedar fuera de alguno de esos consumidores.

Antes del cambio, `node test-screen-registry.mjs` produjo 2 aprobaciones
vacuamente ciertas y 10 fallos: no existía registro, App conservaba sus
catálogos y el build no cargaba una autoridad compartida.

## Causa raíz

El shell creció como un selector local de componentes y no como un router. El
contrato fijo de H-08 no necesitaba descubrir pantallas, por lo que navegación,
presentación y montaje evolucionaron como listas independientes.

## Diseño

`window.SCREENS` es una API inmutable con identidad estable, relación
padre-hijo, presentación, componente y propiedades de montaje. Resuelve los
componentes de forma tardía para conservar el orden de carga existente.

Fase 1 no cambia `AUTH.canAccess()`, caché, datos ni RLS. Administrador conserva
todas las rutas principales y vendedor conserva únicamente `pos`.

## Solución

- `balam/screens.jsx` registra 11 pantallas principales y 11 secciones hijas de
  Configuración.
- App deriva menú, título y montaje del registro.
- Configuración deriva su navegación interna del mismo registro.
- Las entradas de desarrollo y producción cargan el nuevo módulo en el mismo
  orden.
- El build incluye y precompila el registro en ambos artefactos.

No se creó ninguna migración.

## Pruebas

- Línea base: `node test-screen-registry.mjs` — 2/12, 10 fallos.
- Registro final: `node test-screen-registry.mjs` — 12/12.
- Roles: `node test-role-access.mjs` — 15/15.
- Contratos: `node test-module-contracts.mjs` — 39/39.
- Reproducibilidad: `node test-build-reproducibility.mjs` — 8/8.
- Smoke del bundle: `node test-smoke.mjs bundle` — 17/17.
- Navegación del bundle: `node test-ui-navigation.mjs` — 15/15.
- `node build-offline.mjs` — correcto, 70 assets.

## Riesgo residual y pendientes

Fases 2 a 6 permanecen abiertas. Los permisos siguen siendo los roles fijos de
H-08; todavía no existen persistencia por usuario, overrides, caché versionada,
editor triestado ni capacidades de servidor.

La reversión de Fase 1 consiste en retirar `screens.jsx`, restaurar las listas
anteriores en App y Configuración y regenerar los artefactos. No requiere
revertir datos ni migraciones.

## Referencias

- Riesgo: `docs/03-known-risks.md` — H-56.
- Arquitectura: `docs/02-architecture.md` — autorización del esquema `pos`.
- Decisión: `docs/architect/decisions/ADR-005-autorizacion-en-rls.md`.

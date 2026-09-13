# H171 — Continuidad visual del arranque y actualización

**Riesgo:** H-171, reapertura por presentación de arranque.
**Estado:** RESUELTO, PUBLICADO Y VERIFICADO.
**Fecha:** 13/09/2026.
**Commit técnico publicado:** `690344e781109b5b16a3c2ec636da348065bc42c`.

## Problema y reproducción

OWNER mostró la B antigua al iniciar y una pantalla blanca con el mensaje de
actualización. El bundle publicado a47e4b6 reproduce ambos caminos.
`test-h171-startup-brand.mjs` antes de la corrección: **3 PASS / 6 FAIL**,
incluido un destello claro entre el reemplazo del documento y el montaje React.
El arnés usa navegador real, tráfico externo bloqueado e imágenes sintéticas;
no escribe operaciones ni crea cuentas. Los errores mantienen su botón de reintento.

## Causa raíz

`build-offline.mjs` heredaba el cargador del artefacto/backup generado. Ese
cargador leía `balam_config_v1`, incompatible con la autoridad Only Online,
y mostraba B si no encontraba `store.logo`. Además sustituía el documento sin
conservar una cobertura visual hasta que React montara. `startupGate` en
`balam/app.jsx` usaba `bg-surface`, sin logo. H166 había corregido la identidad
PWA y H171 había probado estados posteriores; no la secuencia visual completa.

## Diseño

Fuente explícita del cargador en `balam/`. Una presentación compartida cubre
desempaquetado, entrega a React y espera de autoridad, con fondo corporativo y
logotipo. Una copia estática de presentación del logo confirmado sirve antes
de disponer de CONFIG; los recursos técnicos ya materializados pueden aportar
el último logo confirmado y CONFIG remota prevalece al estar disponible.
No se consulta configuración comercial legacy ni se introduce persistencia
comercial. La copia no es una segunda configuración administrable.

La lectura READ ONLY de `pos.settings/store.logo` produjo PNG SHA256
`0b5529a3688b1cdfb82df062be16cdc6ba3652db5bd54448e6171d74041394ae`.
No cambian AUTH, STORE, permisos, confirmaciones, reintentos ni el protocolo
del worker; su hash de cliente se regenera con el artefacto.
La presentación aplica a todos los roles; los accesos denegados permanecen
denegados. No hay migraciones ni un nuevo contrato distribuido que certificar.

## Solución

`balam/bundle-shell.html` reemplaza la herencia del artefacto generado.
`balam/startup-brand.js` comparte estilos y logo con `startupGate`, monta una
cobertura antes de desempaquetar y la conserva al sustituir el documento.
App la retira únicamente después de montar su siguiente estado. La espera
inicial, con sesión o sin ella, conserva esa misma presentación.
La rama de operación ya abierta y sus borradores no cambian.

El logo de presentación se incorpora al HTML; no necesita una descarga extra
ni una sesión autenticada en la primera apertura. La caché PWA técnica existente
permite usar un logo posterior y CONFIG confirmada tiene prioridad.

## Pruebas

- `test-h171-startup-brand.mjs`: antes **3 PASS / 6 FAIL**; después **9/9 PASS**.
  Apertura limpia/escritorio, caché/móvil, logo configurado, cero lectura legacy,
  actualización oscura y reintento conservado. Los fotogramas claros observados
  pasaron de 15/15 a 0/0. [Antes](evidence/h171/startup-brand/before.json),
  [comprobación focal local](evidence/h171/startup-brand/final.json),
  [captura](evidence/h171/startup-brand/company-logo-loader.png).
- `test-h164-startup-app.mjs`: **8/8 PASS**, permisos, usuario inactivo,
  cambio de usuario, snapshot y confirmación pendiente.
  [Guardas](evidence/h171/startup-brand/startup-guards.json).
- `test-h164-online-ui.mjs`: **6/6 PASS**;
  `test-h164-online-pwa.mjs`: **2/2 PASS** sobre el primer bundle corregido,
  antes de normalizar únicamente los saltos de línea del nuevo cargador.
  [UI local](evidence/h171/startup-brand/local-ui.json),
  [PWA local](evidence/h171/startup-brand/local-pwa.json).
- El workflow exige el nuevo caso de arranque además de regenerar y comparar
  el cliente definitivo. Tras el caso focal local se retiraron únicamente
  espacios de una línea vacía del cargador; CI comprueba el artefacto publicado.
  El workflow final pasó sobre los bytes definitivos, incluido el caso visual.

Todos los fixtures fueron de navegador aislado. **Cero escrituras comerciales,
Auth o Storage remotas**; la única consulta real leyó el logo de la empresa.

## Despliegue

Commit `690344e781109b5b16a3c2ec636da348065bc42c`, workflow [34777097681](https://github.com/David14081982/POS_Balam/actions/runs/34777097681):
regresiones y deploy SUCCESS. La nueva comprobación visual forma parte de este
workflow; la certificación comercial live quedó omitida.
El 2026-09-13T19:21:35.795Z, ambos HTML y sw.js públicos respondieron HTTP 200 y
coincidieron byte por byte con Git. SHA256 HTML:
`47c2b8f1a477c7b183fc63bbe4a515112e67295b1fb717514742b65d57747a34`.
[Constancia](evidence/h171/startup-brand/production.json).
El commit documental posterior registra esta publicación sin cambiar el cliente.

## Riesgo residual y pendientes

Sin pendientes de esta corrección visual. La copia de primer arranque corresponde al logo de esta
entrega; un cambio posterior de logo prevalece al leer CONFIG y se reutiliza
desde la caché visual en aperturas posteriores. Un navegador completamente
nuevo usa la copia publicada hasta conocer CONFIG. No se promete que un equipo
que aún no haya recibido el nuevo HTML ejecute este cargador. Hardware físico
no incluido. Las evidencias previas permanecen históricas.

## Referencias

- [Informe H171](balam-final-readiness.md).
- [Corrección de identidad H166](navegacion-online-h166.md).
- `docs/02-architecture.md`, ADR-015 y `test-h171-startup-brand.mjs`.

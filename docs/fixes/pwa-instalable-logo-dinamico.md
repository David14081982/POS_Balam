# PWA instalable con logo dinámico

**Riesgo:** H-89
**Estado:** RESUELTO
**Fecha:** 09/08/2026
**Commits:** `2dd877f`, `e403d4b`, `af5e599`, `6fd6809`, `c48fe8d`

## Problema y reproducción

La publicación de BALAM no servía manifest, service worker, favicon ni Apple
touch icon. Esas rutas respondían 404 y el logo de
`Configuración → Negocio → Logotipo` se reducía a unos 256 px, por lo que no
podía ser una fuente de calidad real para iconos 512 px. Antes de construir la
PWA tampoco existía evidencia de que Chrome instalara iconos de un manifest
virtual servido desde Cache Storage bajo el subpath `/POS_Balam/`.

El prototipo aislado `prototypes/h89-pwa-runtime-icons/` reprodujo todo el ciclo
en Chrome 151 real: control del scope, materialización 192/512/maskable,
instalabilidad, aceptación del diálogo nativo, archivos instalados y reapertura
mediante el ID interno de la aplicación en `display-mode: standalone`.

## Causa raíz

No había contrato PWA. El riesgo arquitectónico adicional era real: enlazar un
manifest virtual antes de que el service worker controlara la página crearía
una carrera. También se comprobó que `id: "./"` se resuelve contra el origen y
no identifica el project site; el ID estable correcto es `/POS_Balam/`.

La prueba de instalación comparó hashes de los píxeles de los recursos runtime
con los PNG que Chrome copió en su perfil. Coincidieron exactamente para 192,
512 y maskable 512. Al cambiar el logo, Chrome leyó el manifest y los hashes
nuevos sin errores, pero mantuvo inmediatamente el icono activo anterior y
creó `Pending Manifest Icons` con la nueva generación. La sustitución visible
de una aplicación ya instalada depende de la política de actualización de
Chrome/sistema operativo.

## Diseño

- `store.logo` sigue siendo la única autoridad visual administrable.
- Primero se registra y controla el worker; después se generan y cachean todos
  los PNG; el enlace al manifest versionado se añade al final.
- Los recursos usan hash del logo y se conservan dos generaciones para que una
  lectura concurrente nunca encuentre rutas retiradas.
- El manifest usa rutas relativas para inicio, scope e iconos; sólo `id` es la
  ruta absoluta estable requerida por la semántica de identidad de Chrome.
- El service worker limita su caché a shell/assets. No intercepta Supabase,
  APIs ni reemplaza la autoridad offline de `STORE`.
- Una actualización espera confirmación. No ejecuta `skipWaiting` ni recarga de
  forma automática, y la acción se bloquea durante venta, pago, formulario,
  diálogo o cola sin persistencia durable.
- El artefacto `POS Balam (offline).html` no registra service worker.

## Solución

- `balam/pwa.jsx` publica el ciclo de marca, instalación, instrucciones iOS,
  detección de versión y actualización segura.
- `balam/pwa-sw.js` y `balam/pwa-manifest.webmanifest` son las fuentes del shell
  HTTP; `build-offline.mjs` genera manifest, worker versionado y cinco iconos
  fallback reproducibles.
- `balam/settings.jsx` exige 512 px a logos nuevos, conserva hasta 1024 px y
  muestra calidad/estado. Logos históricos menores siguen operando con una
  advertencia explícita.
- `POS Balam.html` añade safe-area, color de tema, favicon y carga el módulo;
  `balam/app.jsx` presenta instalar/actualizar cuando corresponde.
- `PWA.InstallAction` concentra estado, gesto, resultado y fallback iOS. Login y
  topbar consumen ese mismo componente; el login ya no deja el prompt capturado
  sin una acción visible antes de autenticarse.
- `test-h89-pwa.mjs` prueba el contrato productivo sobre Chrome y el bundle.

## Pruebas

- Prototipo headless Chrome: **10/10**.
- Instalación nativa y reapertura headed Chrome: **6/6**; hashes de píxeles
  192/512/maskable iguales a los iconos instalados.
- H-89 productivo: **19/19**.
- Instalación desde login: **10/10**; cubre `canInstall` verdadero/falso,
  aceptación, cancelación, standalone, topbar, iOS y 320/360/390/430 px.
- Contratos de módulos: **42/42**.
- Smoke bundle: **17/17**.
- Build reproducible: **8/8**.
- Responsive H-87: **492/492** en 320, 360, 375, 390, 430, 600, 768, 1024,
  1280 y 1440 px; H-89 repitió el modo standalone en 320, 360, 390, 430, 768 y
  1024 px.
- Instalación sobre los bytes públicos: **6/6** en Chrome real; la acción del
  login fue visible y operable en 320/360/390/430 px, el diálogo nativo fue
  aceptado, no hubo errores de instalabilidad, los píxeles 192/512/maskable
  fueron idénticos y la reapertura de
  `https://david14081982.github.io/POS_Balam/` ocurrió en standalone.
- El arnés descargó el `index.html` publicado, verificó su SHA-256 contra el blob
  del commit y ejecutó esos mismos bytes en origen local controlado: responsive
  público **492/492**.
- Regresiones H-83/H-84/H-85/H-86/H-88A/H-88B ejecutadas antes del build final:
  **32/32 + 17/17**, **19/19**, **18/18**, **37/37**, **30/30** y **19/19**.

Evidencia: `prototypes/h89-pwa-runtime-icons/evidence/chrome-installability.json`
`chrome-real-install.json` y `chrome-published-install.json`, además de capturas
y copias de los PNG instalados.

Los bytes públicos de `sw.js`, manifest e iconos coinciden exactamente con los
locales. El artefacto público `index.html` verificado tiene SHA-256
`60B02D0B5C132D36C41F9E1CE41FB8A9B86C812F238985707DFD77463A9AA33E` y su
regresión responsive terminó **492/492**.

## Riesgo residual y pendientes

Chrome puede conservar temporalmente el icono anterior de una aplicación ya
instalada aunque ya haya descargado la nueva generación. BALAM no puede forzar
desde la web cuándo el sistema operativo aplica ese cambio; instalaciones
nuevas sí usan el logo vigente demostrado. Los logos históricos menores de
512 px se escalan con pérdida de calidad advertida hasta que el administrador
suba una fuente suficiente.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-89---balam-no-tiene-contrato-de-instalación-pwa-ni-materialización-demostrada-del-logo-configurado`
- Arquitectura: `docs/02-architecture.md#instalación-pwa`
- Chrome DevTools, PWA: https://developer.chrome.com/docs/devtools/progressive-web-apps
- Chrome, manifest `id`: https://developer.chrome.com/docs/capabilities/pwa-manifest-id
- MDN, manifest `id`: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id

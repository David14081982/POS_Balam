# Navegación y eficiencia de la autoridad online

**Riesgo:** H-166; QA-NAV-01, QA-BRAND-01, QA-BRAND-02.
**Estado:** CERRADO Y PUBLICADO: QA-NAV-01, QA-BRAND-01 y QA-BRAND-02.
**Fecha:** 12/09/2026, Hermosillo.
**Commit técnico:** `69b5054d4696cfe9d99d679d1da1714949f4a380`.

## Problema y reproducción

El mismo catálogo V2 recalculaba familias en POS, Inventario, Panel, contador y
campana. Clientes y Reportes pagaban ese coste al cambiar de pantalla. La línea
base con 1500 referencias montó 19691 nodos en POS. STORE.init se ejecutaba cada
15 segundos y solicitaba online_snapshot completo aunque nada cambiara.
CONFIG.load emitía siempre; cada evento podía producir otros cinco PNG del mismo
logo. El favicon genérico aparecía antes de conocer CONFIG.

La reproducción previa conserva los recorridos 100/500/1500, dos rondas de cinco
pantallas, tiempos desde click hasta segundo requestAnimationFrame y perfil CPU.
No usa filas, login ni escrituras comerciales reales para el benchmark.

## Causa raíz

referenceFamilyProjection recorría repetidamente toda la colección y repetía
hidratación y clones de CONFIG. El getter DATA.products rehidrataba todas las
referencias por lectura. filtered.map montaba el catálogo completo. La consulta
periódica carecía de revisión condicional y CONFIG no reconocía respuestas idénticas.
PWA no comparaba logo confirmado ni verificaba recursos ya materializados.

## Diseño y solución

Supabase sigue siendo la única autoridad. La revisión de producto cambia por
contenido completo confirmado; CONFIG.version sólo cambia al adoptar contenido
distinto o cambiar readiness. La pareja identifica índice, hidratación y proyección
comercial efímeros. Los consumidores comerciales comparten el resultado. Colecciones
explícitas de borrador no reutilizan datos confirmados; CONFIG preparada no contamina
el memo. Las lecturas públicas de productos conservan copias independientes.

El POS monta bloques de 48 tarjetas al desplazarse. La búsqueda y ambos lectores
consultan todas las identidades, no la ventana visual. No cambian tallas, filtros,
familias, precios, carrito ni products.id/barcode. Con el contenedor real de producción
se verifican 48 tarjetas iniciales y ninguna carga adicional sin desplazamiento.

online_snapshot_if_changed usa una revisión transaccional del servidor y comparte
snapshot MVCC con online_snapshot. El token incluye actor/dispositivo, día y fase de
promociones. Realtime sólo señala cambios de metadatos; nunca aplica sus payloads como
negocio. Foco, reconexión y el intervalo de 15 segundos revalidan autoridad, permisos y
dispositivo, sin colecciones cuando no hay cambio. Los comandos confirmados conservan
su lectura completa obligatoria. Se rechaza un unchanged de otra revisión.

El arranque visual es neutro hasta CONFIG confirmada. Logo idéntico genera 0 PNG;
logo cambiado genera los cinco tamaños. Los recursos comprobados se reutilizan tras
recarga, incluidos los metadatos H164 sin dimensiones. Se serializan las escrituras visuales para que un logo obsoleto no retire
recursos de otro cambio concurrente. Ese almacenamiento contiene sólo presentación.

SQL 220/221 agrega metadatos, invalidación y consulta condicional. SQL 222/223 admite
los builds conocidos H164/H166 en la telemetría de adopción y exige coincidencia entre
build del dispositivo y encabezado. Se preservan dueño, retiro, permisos y frescura.
Las cuatro migraciones se aplicaron y verificaron en Supabase antes del cliente.

## Pruebas y rendimiento

Promedios de las dos rondas, incluido el primer recorrido; no se eliminan valores
atípicos. Son mediciones de este equipo, no un SLA ni comparación entre hardware.
El benchmark conserva su contenedor original; la regresión POS adicional usa la
altura del root real para probar el comportamiento sostenido de la ventana.

| Referencias | Pantalla | Antes ms | Después ms | Mejora |
|---:|---|---:|---:|---:|
| 100 | Punto de venta | 503 | 300 | 40.4% |
| 100 | Inventario | 474 | 179 | 62.2% |
| 100 | Clientes | 408 | 292 | 28.4% |
| 100 | Reportes | 178 | 62 | 64.9% |
| 100 | Panel de control | 405 | 103 | 74.5% |
| 500 | Punto de venta | 1633 | 143 | 91.3% |
| 500 | Inventario | 1156 | 126 | 89.1% |
| 500 | Clientes | 518 | 19 | 96.3% |
| 500 | Reportes | 520 | 42 | 91.9% |
| 500 | Panel de control | 1409 | 46 | 96.7% |
| 1500 | Punto de venta | 5808 | 178 | 96.9% |
| 1500 | Inventario | 4351 | 159 | 96.3% |
| 1500 | Clientes | 2555 | 32 | 98.8% |
| 1500 | Reportes | 2059 | 41 | 98.0% |
| 1500 | Panel de control | 4651 | 189 | 95.9% |

POS: 19691 → 816–1440 nodos en los mismos recorridos. Las 30 transiciones finales
registran 0 reconstrucciones comerciales adicionales. La proyección se calcula
una vez por revisión y cambia correctamente por alta/edición/baja, stock, CONFIG,
logo, Punto Cero, catálogo vacío y sustitución remota. No se leyó/escribió almacenamiento
comercial en las pruebas del modelo.

Pruebas locales ejecutadas: H164 DATA 34; transporte 13; adopción 10; arranque 5;
CONFIG/AUTH/PWA 3; cuenta, identidad, mensajes, Settings y callbacks PASS. UI del
artefacto final 6/6 (Inventario, barcode V3, etiquetas PNG/PDF, Excel, Clientes,
reimpresión histórica y formulario offline); PWA final 2/2; adopción PWA 4 escenarios.
H166 revisiones 12/12 y transporte condicional 5/5; POS: búsqueda de última referencia,
scanner en campo y global, filtro por talla, precio, carrito, catálogo remoto vacío
y anchos 390/768/1280 PASS. La ráfaga HID global se emite dentro del navegador:
los viajes CDP bajo carga no deben introducir pausas humanas de más de 50 ms.
El test POS abre su ruta persistida sin localizar texto visible. Sólo el benchmark
conserva los selectores originales para cumplir la equivalencia exacta solicitada. Marca: 0 PNG idénticos, 5 al cambiar, 0 tras recarga y
recursos completos con escrituras simultáneas ralentizadas PASS.

PostgreSQL local ejecuta migraciones 208–223, incluidas las comprobaciones anteriores
y Punto Cero completo aislado, con configuración preservada. Cadena: 31 PASS.
Verificación remota reversible de roles H166 PASS: anónimo, sin perfil, vendedor,
administrador, administrador inactivo y service_role. El primer intento del fixture
mantuvo JWT vendedor al preparar su estado inactivo; la guarda vigente rechazó ese
setup. Se corrigió el contexto del fixture y toda su transacción revirtió.

A/B/C real del artefacto final: 21 escenarios únicos PASS, certificado y cuentas QA
retiradas. Cero filas previas perdidas o modificadas; cero divergencias en los
dominios comparados. El historial conserva los tres intentos fallidos del arnés
antes de cerrar el caso concurrente y cada recibo. El primer
arranque identificó el allowlist H164 y se corrigió con 222/223. Un observador HTTP
se adelantó al parseo de las respuestas; se corrigió su espera. Una lectura sufrió
statement timeout después de crear el apartado: se conservó su identidad y se continuó
sin crearlo ni cobrarlo otra vez. Ningún RPC comercial se reintenta automáticamente. En la matriz final dos ventas
fueron bloqueadas por revalidación antes del transporte; se archiva el checkpoint
y sólo se retoma si el servidor demuestra que los únicos dos recibos son
reservas de folio y que ninguno de esos folios tiene venta. Las reservas anteriores
quedan intactas; los intentos rechazados del arnés permanecen en la evidencia.

La base del guardián se refijó tras las regresiones locales: máximo medido de
1440 nodos POS, 30 muestras completas y cero cálculos adicionales al navegar.
La repetición del guardián pasó sin cambiar el artefacto; se conserva la primera
medición final en la tabla, no se escoge la repetición más rápida.

## Riesgo residual y despliegue

Publicación verificada el 12/09/2026 a las 20:19 UTC: GitHub Actions
34716573314 completó regresiones y despliegue. HTML y service worker públicos
coinciden por SHA-256 con el artefacto certificado. No quedan pendientes de H166. Las cuentas y operaciones QA tienen identidades
exactas; la historia de prueba se preserva. No se ejecutó Punto Cero sobre la tienda.
Punto Cero se prueba completo en PostgreSQL aislado y con comprobaciones remotas
reversibles. La matriz técnica no certifica adopción de puestos físicos ausentes,
ni sustituye la comprobación física de papel o lector USB del usuario.

El render progresivo puede llegar a montar todo el catálogo cuando el usuario lo
recorre completo; no conserva una caché comercial ni limita resultados. Las lecturas
remotas siguen pudiendo fallar por red/servidor: se bloquea operación sin inventar éxito.

## Referencias

- [Antes](evidence/h166-navigation-before.json) y [después](evidence/h166-navigation-after.json).
- [POS](evidence/h166-pos.json) y [marca](evidence/h166-brand.json).
- Arquitectura: docs/02-architecture.md; autoridad online: ADR-015.

Artefacto certificado: `6759af519a2cc451d3b203afaf3bde5c46d2ebae53870d1644a8e8caf2894c81`.

Evidencia adicional: [A/B/C](evidence/h166-abc.json), [regresiones de navegador](evidence/h166-browser-regressions.json),
[Supabase](evidence/h166-remote-schema.json), [guardián](evidence/h166-performance-guardian.json)
y [self-review](evidence/h166-self-review.json).

[Publicación verificada](evidence/h166-publication.json). Commit documental previo
al despliegue: `c06287f096ce828cc256e573457066d5c631bc54`. El cierre posterior
sólo registra evidencia y conserva los mismos bytes publicados.

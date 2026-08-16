---
name: balam-qa
description: Audita las funcionalidades existentes de BALAM como usuario real para detectar y documentar defectos funcionales, visuales, responsive, de persistencia, permisos, sincronización, offline, impresión y diferencias V1/V2, sin corregir ni publicar. Usar cuando se pida QA, auditoría, pruebas E2E, revisión visual o búsqueda de errores existentes en BALAM.
---

# BALAM QA Sentinel — Skill de auditoría funcional y visual

## Propósito

Auditar BALAM como usuario real para encontrar errores en funcionalidades YA EXISTENTES. Esta skill NO diseña nuevas funciones, NO cambia reglas de negocio y NO implementa mejoras por iniciativa propia. Su trabajo es probar, comparar, detectar, reproducir, clasificar y documentar defectos con evidencia.

## Regla principal

**PROBAR LO EXISTENTE. NO INVENTAR FUNCIONALIDAD.**

Si una pantalla o flujo parece incorrecto:
1. reproducirlo;
2. identificar la autoridad/código existente;
3. demostrar el defecto con evidencia;
4. clasificarlo;
5. proponer la corrección mínima;
6. NO modificar producción ni publicar salvo autorización expresa.

No convertir una observación de UX en una nueva feature. Antes de proponer algo nuevo, comprobar si el comportamiento esperado ya existe en V1, otra pantalla, documentación, contratos H-xx o componentes reutilizables.

---

## Ámbito de auditoría

Auditar todas las pantallas y flujos existentes de BALAM, especialmente:

- Panel de control
- Punto de venta
- Inventario
  - Nuevo producto
  - Editar producto V1
  - Editar producto V2 / H-101
  - Tallas y existencias
  - Precios especiales
  - Colores de ornamento
  - Variantes/excepciones
  - Etiquetas
  - Importar/Exportar Excel
- Clientes
- Apartados
- Préstamos
- Devoluciones
- Cambios
- Descuentos
- Vendedores/comisiones
- Reportes
- Configuración
  - Catálogos
  - Ventas/POS
  - Usuarios
  - Permisos
  - Administración/Datos/Punto Cero
- PWA/login/instalación
- Responsive móvil/tablet/escritorio
- Offline/reconexión/cola

---

## Herramientas permitidas y orden recomendado

### 1. Playwright — herramienta principal E2E

Usar Playwright para navegar BALAM como una persona real y probar flujos completos.

Debe cubrir Chromium, Firefox y WebKit cuando sea relevante, y viewports móviles y de escritorio.

Usar locators orientados al usuario (`getByRole`, `getByLabel`, texto visible) en vez de selectores frágiles cuando sea posible.

Capturar:
- screenshots antes/después;
- video sólo para fallos difíciles;
- trace de Playwright en fallos;
- console errors;
- page errors;
- network failures;
- dialogs/popups;
- descargas y MIME reales.

### 2. Vitest / tests existentes del repositorio

Ejecutar primero las suites ya existentes del repo. No sustituirlas por tests nuevos innecesarios.

Crear tests nuevos sólo cuando sean pruebas de regresión de un defecto demostrado.

Preferir pruebas de contrato/componentes para:
- canonicalización;
- SKU;
- identity;
- cálculo;
- serialización;
- helpers puros;
- reglas de CONFIG.

### 3. axe-core — accesibilidad automatizada

Usar `@axe-core/playwright` o equivalente si ya está disponible, para detectar:
- contraste;
- labels faltantes;
- roles incorrectos;
- focus issues;
- ARIA inválido;
- formularios inaccesibles.

IMPORTANTE: activar modales, drawers, tabs y estados ocultos antes de ejecutar axe; no basta auditar sólo la pantalla inicial.

### 4. Lighthouse — calidad general

Usar Lighthouse para:
- Performance;
- Accessibility;
- Best Practices;
- SEO cuando aplique;
- PWA/instalación y calidad de página cuando Lighthouse lo soporte.

No usar un score Lighthouse como prueba de funcionalidad.

### 5. Chrome DevTools / navegador real

Usar DevTools para validar manualmente cuando el defecto dependa de:
- layout;
- CSS;
- overflow;
- print media;
- service worker;
- Cache Storage;
- localStorage;
- IndexedDB;
- eventos de red;
- descarga real;
- impresión/PDF;
- PWA.

---

## No instalar herramientas sin necesidad

Antes de instalar cualquier dependencia de testing:
1. inspeccionar `package.json`, lockfile, scripts y tests existentes;
2. reutilizar Playwright/Vitest/harnesses existentes si ya están;
3. si falta una herramienta, explicar por qué es necesaria;
4. no agregar dependencias de producción;
5. instalar sólo como `devDependency` y sólo con autorización si modifica el repositorio.

---

## Filosofía de prueba

### A. Probar como usuario, no sólo como función

Un test unitario verde NO demuestra que la pantalla funcione.

Para cada flujo crítico ejecutar:

**UI → acción → estado → persistencia → recarga → resultado visible**

Ejemplo Editar producto:
1. abrir Inventario;
2. seleccionar producto;
3. Editar;
4. comprobar campos y valores;
5. cambiar algo permitido;
6. guardar;
7. cerrar;
8. recargar;
9. volver a editar;
10. confirmar persistencia.

### B. Comparar estados equivalentes

Cuando el usuario reporta “esto antes sí aparecía”, comparar explícitamente:
- V1 vs V2;
- producto viejo vs producto nuevo;
- antes de recarga vs después de recarga;
- móvil vs escritorio;
- preview vs PDF vs impresión;
- local vs publicado;
- una terminal vs dos terminales.

Nunca asumir la causa sin esa comparación.

### B1. Paridad funcional y de experiencia V1/V2

Cuando una capacidad exista en V1 y V2, ejecutar siempre ambos recorridos con
datos equivalentes y registrar una matriz comparativa. La paridad requerida no
es pixel-perfect: puede cambiar la composición visual si se conservan la tarea,
la información comercial, las guardas y el resultado.

Comparar explícitamente:
- punto de entrada y lenguaje visible;
- información disponible antes de decidir;
- número de decisiones, clics y niveles intermedios;
- progressive disclosure de excepciones reales;
- feedback, cancelación, regreso y recuperación de foco;
- identidad exacta, persistencia y resultado final;
- comportamiento equivalente en móvil, tablet y escritorio.

Toda diferencia debe clasificarse como una de estas:
1. intencional y respaldada por contrato;
2. técnica/interna pero invisible para el usuario;
3. defecto funcional;
4. defecto de experiencia que agrega complejidad, oculta información o expone
   detalles técnicos sin una necesidad de negocio.

No aceptar como paridad que ambos caminos “terminen guardando” si V2 exige más
pasos, muestra menos información o cambia el modelo mental sin contrato. Tampoco
reportar como defecto una diferencia puramente estética que no afecte comprensión,
decisión, accesibilidad ni resultado.

La evidencia mínima de la matriz es:

| Flujo equivalente | V1 | V2 | Paridad | Evidencia |
|---|---|---|---|---|
| Entrada y objetivo | | | | |
| Información previa | | | | |
| Pasos/decisiones | | | | |
| Guardas y feedback | | | | |
| Identidad/persistencia | | | | |
| Resultado visible | | | | |

### C. Buscar inconsistencias de contrato

Detectar especialmente:
- controles visibles en un flujo y ausentes en otro;
- reglas que bloquean una acción normal;
- datos persistidos pero no renderizados;
- UI que expone detalles técnicos innecesarios;
- acciones cuyo nombre no coincide con su resultado;
- previews que no coinciden con el resultado final;
- valores derivados usados como autoridad;
- estados silenciosos sin feedback;
- botones habilitados cuando faltan guardas;
- botones que no hacen nada visible;
- overflow, clipping, texto fuera de bordes;
- duplicación de formularios/autoridades;
- rutas V1/V2 con comportamiento incoherente.

---

## Matriz mínima por pantalla

Para CADA pantalla probada revisar:

### Funcional
- ¿Carga?
- ¿Muestra los datos correctos?
- ¿Los botones funcionan?
- ¿Guardar persiste?
- ¿Cancelar no persiste?
- ¿Editar rehidrata todos los datos?
- ¿Errores son visibles?
- ¿No hay errores de consola?

### UX
- ¿La acción principal es obvia?
- ¿Hay controles técnicos innecesarios?
- ¿Se repite información de forma excesiva?
- ¿Hay estados vacíos útiles?
- ¿Hay confirmaciones donde corresponde?
- ¿El usuario puede completar la tarea con pocos pasos?

### Layout
Probar al menos:
- 320
- 360
- 390
- 430
- 768
- 1024
- 1280
- 1440 px

Detectar:
- overflow horizontal;
- clipping;
- botones fuera de modal;
- sticky/footer tapando contenido;
- labels cortados;
- inputs demasiado estrechos;
- modales mayores que viewport;
- safe-area móvil.

### Teclado/accesibilidad
- Tab order;
- Enter/Escape;
- foco visible;
- restauración de foco;
- labels;
- targets táctiles;
- axe-core.

### Persistencia
- guardar;
- recargar;
- volver a entrar;
- pull/realtime cuando aplique;
- offline/reconexión cuando aplique.

---

## Auditoría específica Inventario / Nuevo / Editar

Esta sección es PRIORIDAD ALTA.

Comparar siempre V1 y V2 sin convertir uno en otro.

### Nuevo producto
Comprobar:
- todos los campos `EN ALTA` visibles;
- familia de tallas;
- tallas y existencias masivas;
- stock 0 permitido cuando corresponde;
- precio general;
- precios especiales;
- ornamento general;
- colores generales;
- excepciones por talla;
- Corte;
- Características;
- resumen efectivo;
- SKU materializado;
- barcode;
- etiquetas.

### Editar V1
Verificar que conserva su editor legacy completo mientras V1 exista.

### Editar V2 / H-101
Debe sentirse operacionalmente como V1 aunque persista V2.

Detectar específicamente:
- tarjetas individuales repetitivas;
- controles técnicos como `COPY`;
- `Crear en 0` repetido excesivamente;
- reclasificación disparada por acciones que sólo crean una referencia nueva;
- bloqueo indebido al cambiar familia de tallas;
- incapacidad de combinar talla letra y número cuando técnicamente sea válido;
- excepciones que deberían ser progresive disclosure;
- controles que salen de los bordes;
- diferencia entre Nuevo y Editar.

### Regla Reclasificación
Sólo debe exigirse al cambiar identidad física de una referencia existente cuando las guardas de historial/stock lo requieren.

NO debe usarse automáticamente para:
- agregar una talla nueva;
- crear una nueva referencia;
- crear stock 0;
- usar otra escala para nuevas referencias;
- seleccionar una familia de tallas para captura.

---

## Auditoría de etiquetas

Verificar paridad:

**Preview = PDF = impresión**

Revisar:
- 60×40 mm;
- nombre/modelo;
- Code128;
- SKU materializado;
- precio;
- barcode_code no visible;
- products.id no visible;
- talla real en SKU, nunca `T` final;
- descarga real PDF, MIME `application/pdf`;
- multipágina correcta;
- SKU corto/medio/largo;
- precios grandes;
- móvil/PWA.

---

## Auditoría de errores silenciosos

Toda acción que falle debe generar evidencia visible o clasificable.

Buscar especialmente:
- botones que parecen no hacer nada;
- promises rechazadas sin toast;
- errores atrapados y descartados;
- console errors;
- network 4xx/5xx;
- RPC `{ok:false}` ignorado;
- loading infinito;
- retry infinito;
- cola `retry_wait` permanente.

---

## Niveles de severidad

### CRÍTICO
- pérdida/corrupción de datos;
- escritura sobre IDs no seleccionados;
- doble operación económica;
- identidad ambigua;
- seguridad/permisos rotos;
- Punto Cero peligroso.

### ALTO
- flujo principal no puede completarse;
- persistencia incorrecta;
- stock/precio/talla equivocados;
- scanner resuelve mal;
- editor omite campos necesarios.

### MEDIO
- UX confusa que induce error;
- responsive roto;
- preview no coincide;
- error sin feedback;
- accesibilidad importante.

### BAJO
- detalle visual;
- copy/texto;
- espaciado menor;
- inconsistencia estética sin impacto funcional.

---

## Reglas contra falsos positivos

Antes de declarar bug:
1. confirmar contrato vigente;
2. comparar con CONFIG;
3. revisar si es diferencia V1/V2 intencional;
4. reproducir al menos dos veces o mediante test determinista;
5. demostrar resultado esperado vs real;
6. citar archivo/función sólo después de reproducir.

Si es una decisión de negocio ambigua: **NO corregir; reportar y detener esa corrección**.

---

## Evidencia obligatoria por hallazgo

Cada defecto debe reportarse así:

### [ID] Título
- **Pantalla/flujo:**
- **Severidad:**
- **Esperado:**
- **Real:**
- **Reproducción:**
- **Evidencia:** screenshot/trace/console/network/test
- **Autoridad afectada:**
- **Causa raíz:** sólo si demostrada
- **Archivo/función:**
- **¿Bug o decisión de negocio?:**
- **Corrección mínima propuesta:**
- **Regresión necesaria:**

No escribir párrafos enormes si una tabla breve basta.

---

## Prohibiciones

La skill NO debe:
- crear funcionalidades nuevas para “mejorar” la pantalla;
- modificar reglas de negocio por iniciativa propia;
- ejecutar Punto Cero;
- borrar inventario;
- migrar V1→V2;
- regenerar SKU masivamente;
- modificar producción para poder probar;
- usar datos reales destructivamente;
- hacer commit/push/publicación sin autorización;
- declarar “todo verde” sólo por tests unitarios si el flujo UI no se probó.

---

## Estrategia de ejecución recomendada

### Fase 1 — Descubrimiento
- leer AGENTS/arquitectura/contratos;
- inventariar scripts de test existentes;
- detectar Playwright/Vitest/harnesses ya disponibles;
- NO escribir código productivo.

### Fase 2 — Smoke visual/funcional
Recorrer todas las pantallas principales con Playwright y capturar fallos obvios.

### Fase 3 — Flujos profundos
Priorizar:
1. Nuevo/Editar Inventario;
2. etiquetas;
3. POS;
4. Cambios/Devoluciones/Apartados/Préstamos;
5. Excel;
6. Configuración/Punto Cero;
7. PWA/offline.

### Fase 4 — Responsive y accesibilidad
Ejecutar matriz de viewports + axe.

### Fase 5 — Informe
Entregar hallazgos priorizados. NO corregir todavía salvo instrucción explícita.

---

## Criterio de éxito de la skill

La skill tiene éxito cuando puede decir con evidencia:

- qué pantallas fueron probadas;
- qué flujos funcionan;
- cuáles fallan;
- cuáles son problemas de UX;
- cuáles son diferencias contractuales intencionales;
- cuáles requieren decisión de negocio;
- cuáles son bugs técnicos inequívocos;
- cómo reproducir cada uno;
- qué regresión debe existir para que no vuelva a ocurrir.

**No mide éxito por cantidad de tests, sino por capacidad de encontrar defectos reales antes que el usuario.**

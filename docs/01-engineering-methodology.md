# Metodología de ingeniería

Esta metodología es obligatoria para cada diagnóstico y corrección. Las etapas
se ejecutan en este orden y no se declara el cierre si alguna queda sin
evidencia.

## 1. Comprender

- Delimitar el problema, el comportamiento esperado y lo que queda fuera.
- Leer arquitectura, riesgos conocidos, correcciones anteriores y código del
  módulo.
- Identificar datos afectados, consumidores, rutas offline/nube y restricciones
  de compatibilidad histórica.
- Anotar supuestos; confirmar los que puedan cambiar el resultado.

**Salida:** alcance concreto y criterio observable de éxito.

## 2. Reproducir

- Construir el caso mínimo que demuestre el fallo.
- Registrar precondiciones, datos, pasos, resultado actual y resultado esperado.
- Preferir una prueba automatizada que falle antes del cambio.
- Si no se puede reproducir directamente, aportar evidencia equivalente
  (traza, consulta, diff de datos o camino de ejecución) y explicar la
  limitación.

**Salida:** reproducción repetible o evidencia verificable.

## 3. Causa raíz

- Seguir el dato desde su origen hasta persistencia y lectura.
- Distinguir causa raíz, síntomas y factores contribuyentes.
- Señalar el punto exacto donde se rompe el contrato.
- No proponer la corrección definitiva hasta poder explicar por qué ocurre.

**Salida:** explicación causal respaldada por código o datos.

## 4. Diseño

- Definir el contrato correcto y las invariantes que deben conservarse.
- Evaluar impacto en `DATA`, `CONFIG`, `AUTH`, `STORE`, Supabase, sincronización,
  `localStorage`, cola offline, datos históricos e interfaz.
- Elegir el cambio mínimo que resuelva la causa completa.
- Definir migración, compatibilidad, idempotencia, concurrencia y recuperación
  ante fallos cuando apliquen.

**Salida:** diseño de solución y plan de pruebas.

## 5. Corrección

- Modificar la fuente, no solamente el síntoma ni el artefacto generado.
- Mantener el cambio dentro del alcance acordado.
- Evitar reescrituras o limpiezas no relacionadas.
- Añadir defensas únicamente cuando protejan una invariante identificada.

**Salida:** cambio revisable que implementa el diseño.

## 6. Pruebas

- Ejecutar primero la reproducción y después regresión proporcional al riesgo.
- Cubrir caso correcto, límites, error, offline/reintento, compatibilidad
  histórica y concurrencia cuando correspondan.
- Registrar comandos y resultados exactos; no convertir pruebas no ejecutadas
  en pruebas aprobadas.
- Si alguna prueba no puede ejecutarse, documentar motivo y riesgo.

**Salida:** evidencia de que se corrigió el fallo sin regresiones conocidas.

## 7. Documentación

- Crear o actualizar un archivo en `docs/fixes/`.
- Actualizar `docs/03-known-risks.md` con estado, commit, fecha, pruebas,
  pendientes y riesgo residual.
- Actualizar `docs/02-architecture.md` si cambió un contrato o flujo estructural.
- Documentar decisiones duraderas, no el relato completo de la conversación.

**Salida:** conocimiento suficiente para que otra sesión continúe sin
reinvestigar desde cero.

## 8. Cierre

- Confirmar el criterio de éxito y el estado real: resuelto, parcialmente
  resuelto, bloqueado o abierto.
- Comprobar que código, pruebas y documentación coinciden.
- Informar archivos cambiados, pruebas y riesgos residuales.
- No comenzar el siguiente problema. Esperar una nueva instrucción.

**Salida:** estado auditable y punto de continuación explícito.

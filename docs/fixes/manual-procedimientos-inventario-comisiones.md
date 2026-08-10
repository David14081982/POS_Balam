# Manual de procedimientos de Inventario y Comisiones

**Riesgo:** H-91  
**Estado:** RESUELTO Y PUBLICADO  
**Fecha:** 10/08/2026  
**Commit técnico:** `4998c06`

## Problema y evidencia

El manual de operación existente precedía H83, H84, H86, H88B y H69, por lo que no podía enseñar el formulario vigente, las excepciones por talla, el contrato Excel, las etiquetas móviles ni la política marginal de comisiones. La solicitud exige documentación para empleados y prohíbe modificar el sistema.

## Alcance y solución

Se auditó la condición implementada/publicada/documentable contra riesgos, correcciones, código y pruebas. Se creó un manual fuente HTML independiente, conservando portada, paleta, tipografías, avisos, tablas, figuras y formato carta del manual vigente. Se generaron capturas nuevas con datos de demostración sobre el build actual y un PDF con numeración.

No se modificaron `balam/`, DATA, CONFIG, STORE, Supabase, migraciones ni artefactos productivos. Los sufijos SKU `-01/-02/-03` y el bono automático se declaran no disponibles.

## Pruebas

- Capturador oficial vigente: recorrido completo, capturas de Inventario, Etiquetas, Configuración, Usuarios y Vendedores; cero errores JS.
- `node docs/manual-procedimientos/generar-pdf.mjs`: PDF generado.
- `node docs/manual-procedimientos/validar-manual.mjs`: 12 secciones, 9 imágenes cargadas, cero recursos rotos, cero desbordes horizontales y cero errores de página.
- Revisión visual de portada, H83/matriz y comisiones; identidad editorial y legibilidad conformes.

## Riesgo residual

La lectura física de etiquetas depende de impresora, papel, escala y lector. El manual debe versionarse cuando cambie el sistema publicado o la política comercial. No se realizó despliegue: la historia es documental.

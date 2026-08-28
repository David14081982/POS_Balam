# Historial de correcciones

Un archivo por corrección conserva la causa y la evidencia más allá de una
sesión de chat.

## Cómo usar este directorio

- Antes de modificar un módulo, leer las correcciones relacionadas.
- Crear el documento desde `_template.md` durante la etapa de documentación.
- Usar nombres estables en minúsculas y con guiones.
- Enlazar el riesgo de `../03-known-risks.md`.
- No inventar commits, fechas ni resultados de pruebas.

## Correcciones registradas

| Archivo | Riesgo | Tema |
|---|---|---|
| `admin-users-auth.md` | H-05 | Autorización de usuarios mediante Edge Function |
| `concurrencia-multi-terminal.md` | H-06 | Versionado optimista, conflictos y tombstones |
| `rls-administrador-activo.md` | H-07 | Acceso al dominio sólo para administrador activo |
| `vendedor-solo-punto-venta.md` | H-08 | Administrador completo y vendedor sólo Punto de Venta |
| `inventario-concurrente.md` | H-01 | Reserva atómica e idempotente de stock por venta |
| `venta-transaccional-idempotente.md` | H-04 | Venta y devolución transaccionales e idempotentes |
| `folios-multi-terminal.md` | H-02 | Identidad inmutable y folios únicos offline |
| `aislamiento-cola-por-sesion.md` | H-09 | Cola offline aislada por identidad |
| `migraciones-reproducibles.md` | H-10 | Cadena formal y contrato de esquema |
| `margen-minimo-promociones.md` | H-11 | Piso de margen en promociones |
| `lector-excel-seguro.md` | H-12 | Dependencia Excel fijada y lectura con límites |
| `recuperacion-movimientos-terminal.md` | H-13 | Reconstrucción del kardex desde Supabase |
| `diagnostico-cola-offline.md` | H-14 | Diagnóstico y recuperación de la cola offline |
| `arnes-smoke-confiable.md` | H-15 | Smoke E2E aislado, confiable y con cleanup |
| `paginacion-volumen-sincronizacion.md` | H-16 | Paginación completa e índices medidos |
| `limpieza-codigo-recursos.md` | H-17 | Código muerto y CSS no cargado |
| `identidad-terminal-compartida.md` | H-18 | Contrato único de identidad de terminal |
| `bundle-reproducible.md` | H-19 | Identidad determinista de assets del bundle |
| `build-sin-dependencias-remotas.md` | H-20 | Recursos externos fijados y build sin red |
| `desacoplar-config-data.md` | H-21 | Adaptador de productos entre CONFIG y DATA |
| `desacoplar-data-store.md` | H-22 | Gateway de sincronización entre DATA y STORE |
| `desacoplar-config-store.md` | H-23 | Gateway de sincronización entre CONFIG y STORE |
| `desacoplar-auth-store.md` | H-24 | Gateway de cliente entre AUTH y STORE |
| `selector-segmentado-compartido.md` | H-25 | Selector común de Clientes e Inventario |
| `procesamiento-imagenes-compartido.md` | H-26 | Lectura y reducción común de imágenes |
| `arneses-e2e-sin-cdn.md` | H-27 | Ocho recorridos E2E sobre el bundle local |
| `sdk-supabase-local-fijado.md` | H-28 | SDK de navegador local, exacto y verificable |
| `eligible-active-sellers.md` | H-29 | Vendedores comerciales activos y elegibles |
| `fotografias-vendedores.md` | H-30 | Fotografías en la pantalla Vendedores |
| `autoridad-comision-efectiva.md` | H-31 | Precedencia y compatibilidad del porcentaje efectivo |
| `trazabilidad-descuento-ticket.md` | H-32 | Evidencia del descuento por renglón y formato de Finanzas |
| `folio-comercial-diario.md` | H-33 | Folio corto con consecutivo diario y contador central |
| `plazo-posventa.md` | H-34 | Plazo de devolución configurable y congelado en la venta |
| `saldo-por-renglon.md` | H-35 | Autoridad única del saldo por renglón entre devoluciones y cambios |
| `precio-por-talla.md` | H-36 | Precio general del artículo con excepciones por talla |
| `modelo-del-cambio.md` | H-37 | Modelo del cambio de mercancía y costura de suministro (C4) |
| `commit-transaccional-cambio.md` | H-38 | Autoridad transaccional del cambio (C5) |
| `pantalla-del-cambio.md` | H-42 | Pantalla del cambio, atribucion y comprobante (C6) |
| `pantalla-apartados.md` | H-40 | Pantalla de apartados, abono con forma de pago y comprobante |
| `ticket-impreso-paginado.md` | H-41 | El comprobante impreso se cortaba en la primera hoja |
| `pantalla-prestamos.md` | H-46 · H-48 · H-50 | Préstamos de mercancía: documento, cartera, vale firmado, lector y fechas |
| `reportes-del-cambio.md` | H-51 | Trazabilidad de cambios, comisión por origen y valor no aprovechado |
| `descuento-adicional.md` | H-52 | Beneficios manuales integrados a la cotización y documento de venta |
| `descuento-adicional-manual.md` | H-53 | Porcentaje e importe manual administrables |
| `editor-simple-de-beneficios.md` | H-54 | Editor administrativo claro y responsivo de beneficios |
| `duplicar-beneficios.md` | H-55 | Copia independiente de una opción de beneficio |
| `autoridad-categorias-por-talla.md` | H-57 | Categoría y existencias por talla compartidas por POS e Inventario |
| `menu-filtro-tallas.md` | H-58 | Fondo normal del menú nativo del filtro de tallas |
| `auditoria-categorias-talla.md` | H-59 | Autoridad, orden, importación, consumidores y persistencia canónica de categorías por talla |
| `arranque-catalogo-vacio.md` | H-60 | Arranque seguro, UUID de productos y recuperación selectiva de cola |
| `filtro-tallas-por-categoria.md` | H-61 | El filtro de tallas del POS es una estructura por categoría, no una lista plana |
| `tallas-historicas-con-existencias.md` | H-63 | Una talla numérica con referencias vivas no puede desactivarse (fase 1: protección) |
| `talla-mal-codificada-en-catalogo.md` | H-64 | La talla 38 estaba codificada como «0»; se corrigió el catálogo sin mover existencias |
| `liquidacion-apartado-autoridad-stock.md` | H-65 | Liquidación atómica e idempotente con stock confirmado por el servidor |
| `columnas-de-talla-en-excel.md` | H-67 | La columna de Excel se llama como la talla; las piezas se siguen localizando por la identidad interna |
| `clientes-y-sus-ventas.md` | H-70 | Las compras de cada cliente se derivan de sus ventas por identidad, no de contadores desnormalizados |
| `devolucion-por-identidad.md` | H-71 | La devolución restituye el inventario al producto congelado en la venta, y bloquea cuando no puede identificarlo |
| `identidad-en-posventa.md` | H-72 | Devolución, cambio, pantalla del Cambio y pull dejan de resolver la pieza por SKU o por el catálogo vigente |
| `comprobante-del-cambio.md` | H-73 | El comprobante decide su vocabulario por el tipo real de la operación, no por la presencia de la costura de pago |
| `codigos-de-talla-reales.md` | H-74 | Los códigos de talla pasan a ser la talla real y todas sus referencias se migran en un solo acto verificado |
| `cobro-del-cambio-por-forma-de-pago.md` | H-75 | La diferencia de un cambio se clasifica por su forma de pago real, no todo al cajón «otro» |
| `vaciar-inventario.md` | H-76 | Vaciar el inventario entero para reemplazarlo, con respaldo obligatorio, guardas e invariante |
| `punto-cero-administrativo.md` | H-98 | Punto Cero permanente con modo, preview, respaldo, RPC transaccional y auditoría |
| `limpieza-selectiva-datos-prueba.md` | H-113 | Limpieza selectiva por grupos semánticos con restauración V1/V2 exacta y protocolo propio |
| `limpieza-h113-riesgo-real-equipos.md` | H-116 | Riesgo real de flota para H-113 sin depender de equipos apagados |
| `simplificacion-limpieza-datos-prueba.md` | H-117 | Proyección humana y flujo principal único sobre H-113/H-116 |
| `reconciliacion-sync-activity-historica.md` | H-118 | Pendientes actuales separados de incidencias históricas para H-113 |
| `limpieza-solo-devoluciones.md` | H-119 | Alcance exacto, no-op y habilitación real al limpiar sólo Devoluciones |
| `consistencia-devoluciones-limpieza.md` | H-120 | Documento de devolución, estado de venta y limpieza convergen sin reinterpretar históricos |
| `autoridad-unica-datos-h121.md` | H-121 | Evidencia forense, rebootstrap controlado y una autoridad confirmada por dominio |
| `claridad-dominios-limpieza.md` | H-122 | Documentos borrables separados de candidatos y saldos derivados |
| `evidencias-huerfanas-devoluciones.md` | H-123 | Operación terminal exacta para comprobantes de devolución sin documento comercial |
| `estabilidad-preview-limpieza.md` | H-124 | Huella comercial estable ante latidos y recuperación segura del preview cambiado |
| `proyeccion-atencion-centro-equipos.md` | H-125 | Actividad historica separada de atencion y reintento vigente |
| `lector-guiones-apostrofes.md` | H-126 | Respaldo de distribución de teclado para lectores HID sin modificar SKU ni identidad |
| `autoridad-fisica-code128-h127.md` | H-127 | Geometría Code128 única para preview/PDF/impresión y diagnóstico por etiqueta |
| `recuperacion-layout-v1-denso-h128.md` | H-128 | Límite físico 60×40, simulación V1, `Ñ` y mejora vertical sin cambiar identidad |
| `jerarquia-visual-etiqueta-60x40.md` | H-99 | Jerarquía visual 60×40 con identidad V2 intacta |
| `sku-materializado-en-etiquetas.md` | H-100 | SKU visible por talla con paridad preview/PDF/impresión |
| `chips-existencias-familiares.md` | H-103 | Chips compactos con proyección familiar V2 intacta |
| `sku-visual-familiar-inventario.md` | H-104 | SKU familiar derivado sólo para la lista de Inventario |
| `selector-color-ornamento-legible.md` | H-106 | Selector legible y responsive para 68 colores de ornamento |
| `color-tela-en-detalle-familiar-v2.md` | H-107 | Color tela común legible en el detalle familiar V2 |
| `renovacion-sesion-sin-bloqueo.md` | H-78 | Renovar la sesión sin desmontar temporalmente el POS |
| `centro-de-equipos.md` | H-79 | Supervisión central por instalación, actividad y reintentos administrativos |
| `convergencia-centro-de-equipos.md` | H-80 | El historial operativo converge sin tráfico ni reconciliación comercial autorreferente |
| `revision-de-cuarentena.md` | H-81 | Expediente Excel, decisión auditada y reactivación por la cola/RPC vigente |
| `sistema-de-comprobantes-historicos.md` | H-85 | Evidencia visual congelada, reimpresión, Reportes y devolución imprimibles |
| `pwa-instalable-logo-dinamico.md` | H-89 | Instalación PWA, iconos derivados del logo configurado y actualización segura |
| `autoridad-monetaria-y-reporte-por-metodo.md` | H-90 | Componentes monetarios dinámicos, reembolsos exactos, conciliación y reporte A4 |
| `atributos-opcionales-canonicos.md` | H-86 | Representación única de atributos custom opcionales en DATA, firma, snapshots y Excel |
| `certificacion-preproduccion-v2.md` | H-110 | Recorrido V2 transversal, aislado y con limpieza exacta |
| `paridad-selector-tallas-pos-v1-v2.md` | H-111 | POS V1/V2 selecciona primero talla y preserva la referencia física exacta |
| `persistencia-corte-caracteristicas-editar-v2.md` | H-115 | Editar V2 materializa Corte y Características antes de validar/persistir cada referencia |
| `paridad-capacidad-baja-productos-v1-v2.md` | H-114 | Baja V1/V2 exacta, familiar, durable y atómica sin reescribir históricos |

Documentación financiera relacionada, creada antes de este índice:

- `../H-03-coherencia-cobro.md`
- `../trazabilidad-financiera.md`

Cuando H-03 vuelva a modificarse, su nuevo documento de corrección debe crearse
en este directorio; los documentos anteriores se conservan como evidencia.

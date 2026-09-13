# H171 — Limpieza comercial exacta preparada para revisión

Estado: **149/149 ELIMINADAS Y VERIFICADAS** mediante la copia con contexto de
mantenimiento aprobada explícitamente por el OWNER. El original auditado sigue
intacto. BALAM
Supabase `telohdbvbvsfmwyriflz`. Fecha: 2026-09-13 UTC.

El intento original terminó en `DEVICE_RETIRED` y rollback total verificado.
El OWNER aprobó después `h171-cleanup-owner-context-reviewed.sql`, SHA256
`c2ef25b409b2abe56e793e4e152bd9c2e89b29efa4933c49fd5134cd1721e440`.
Su única diferencia y las seis pruebas están en
[la revisión de contexto](h171-owner-context-review.md).
La ejecución terminó con código 0 y reporte de 149 eliminadas.
[La consulta independiente posterior](h171/commercial-post-delete.json)
confirma 149 PK ausentes, 35/35 tablas protegidas idénticas al dry-run original,
973 productos activos, 251 familias, 3483 piezas y venta 0001 íntegra.
Los cuatro registros ambiguos siguen preservados. Auth y Storage no se tocaron.
El registro [de ejecución](h171/commercial-owner-context-execution.json)
conserva cada PK/hash retirada. No hubo rebobinado de contadores o revisiones.

Se retiraron **149 filas comerciales identificadas por clave primaria y
huella completa**, incluidos 14 productos QA y 7 ventas QA. El resultado conserva
973 productos activos, 251 familias, 3,483 piezas y la venta real
`BG-260912-0001`, con todos sus datos y pago.

Este alcance **no completa cero QA total**: cuentas Auth, auditorías y recibos
técnicos, instalaciones y cuatro registros dinámicos ambiguos quedan fuera.
No declarar aptitud final ni ausencia total de QA a partir de esta limpieza.

## Archivos y respaldo

- [Transacción preparada](h171-cleanup-reviewed.sql): contiene COMMIT; NO ejecutar
  sin la aprobación del dueño. Sólo selecciona IDs/PK y hashes ya revisados.
- [Dry-run v2](h171-cleanup-dry-run-v2.sql) y
  [resultado remoto v2](h171/cleanup-dry-run-v2-before.json).
- [Catálogo vivo](h171/cleanup-catalog-before.json): 112 triggers, 22 funciones
  obtenidas del servidor, PK y cuenta CLI postgres. Las definiciones no se cambian.
- [Manifiesto del respaldo](h171/backup-manifest.json): 35 tablas completas;
  respaldo privado excluido de Git, sin credenciales Auth.
  SHA256 `6a6c9b084af4432c22f313a5bb908ab54a9e1104c47ba6ea09b597252d92d825`.
- El dry-run de 144 filas se conserva como diagnóstico inicial. Sus dos
  referencias externas a overrides de cuentas QA se cerraron por PK compuesta.
  Se añadieron además dos perfiles y una clave H148 demostrados por runner/certificado.

## Alcance por tabla

| Tabla pos | Filas |
|---|---:|
| `clients` | 5 |
| `exchange_commits` | 2 |
| `exchange_items` | 4 |
| `exchanges` | 2 |
| `layaway_liquidation_commits` | 2 |
| `liquidations` | 2 |
| `loan_documents` | 2 |
| `movements` | 17 |
| `products` | 14 |
| `promotions` | 5 |
| `reference_reclassifications` | 2 |
| `return_commits` | 2 |
| `return_items` | 2 |
| `returns` | 2 |
| `sale_commits` | 11 |
| `sale_items` | 7 |
| `sale_payments` | 13 |
| `sales` | 7 |
| `sellers` | 27 |
| `settings` | 6 |
| `stock_reservations` | 7 |
| `user_permission_role_assignments` | 3 |
| `user_screen_permission_overrides` | 5 |
| **Total** | **149** |

Las ventas exactas son `BG-260912-0002`, `0004`, `0007`, `0008`, `0009`,
`0010` y `0014`. No basta compartir folio con un ensayo viejo: se cruzaron
operación, actor/recibo confirmado, cliente y todas las líneas de producto.
Los cambios QA usan folios `0006` y `0013` y aportan dos de los 13 pagos.

Los 17 movimientos corresponden a productos QA y referencias exactas de esos
documentos o a las dos reclasificaciones con ambos productos del mismo run.
Los dos préstamos están devueltos y contienen únicamente productos QA.

Los IDs deterministas H148 de admin, vendedor y configuración proceden del
runner SHA256 `ade64ab0199a456770f4f2053bd768fc223a99799c3c83210a727645fc71bbf3`,
idéntico al certificado
`C:/tmp/balam-h154-live-mXd8pe/matrix.json`, SHA256
`b4c86b1bc8a63464f44d3d45a203bc46d8f9b937b541fd3220c58a99faa3ee38`.
Los cuatro registros dinámicos sin ese nivel de trazabilidad no se incorporaron.

## Condiciones de la transacción

1. Requiere sesión estándar postgres sin identidad Auth, Only Online activado y
   ninguna operación comercial en estado executing.
2. Serializa la revisión y el borrado mediante locks transaccionales de las tablas
   comerciales, sus referencias y el fence de recuperación. Timeout de lock 5 s;
   si hay conflicto, aborta. Mantiene los triggers y FKs activos.
3. Fija UTC e ISO para que las huellas de timestamps sean reproducibles.
4. Reejecuta exactamente el manifiesto de 149 filas; exige una sola PK por huella,
   cero diferencias de hash, cero padres incorrectos, cero referencias externas
   comerciales y cero aliases/mapas V1/V2 de los productos QA.
5. Verifica que las funciones y el conjunto de triggers conservan el catálogo
   leído. No desactiva fences, permisos ni la protección del último administrador.
6. Captura conteos y hashes de **todas las filas fuera del alcance de las 35
   tablas** dentro de los locks. Borra por tabla en orden de dependencias; cada
   sentencia exige el conteo exacto previsto y cada fila su PK más hash.
7. Compara todas las tablas restantes con esa captura. Cualquier cambio ajeno,
   incluso de contador, lookup, configuración, perfil o producto real, aborta
   toda la transacción.
8. Revalida 973 productos/251 familias/3,483 piezas, hash completo del inventario
   real `f9e21666ec904d536d7e7273b581cf09` y hash de venta 0001
   `4d4eccadf33a73be1303d957036886d6`. Fuerza constraints diferidos antes de COMMIT.
9. Devuelve manifiesto de filas retiradas y hashes protegidos, que deben guardarse
   como evidencia del resultado de ejecución. El trigger existente incrementa la
   revisión del snapshot para que los clientes online lean el nuevo estado.

No usa Punto Cero, nombres/prefijos de búsqueda como condición de DELETE,
reseteo de folios, restauración de stock QA sobre productos reales ni cambios
de configuración ajena. Los recibos online no se repiten ni se ocultan.

## Verificación ejecutada

- Remoto **sólo lectura**: 149 esperadas/149 encontradas; cero fallos de hash,
  cero fallos de padres, cero referencias externas, cero blockers de productos.
  Ambas guardas de inventario y venta real son true.
- PGlite local con copia privada de las 35 tablas, columnas y PK reales, FKs
  comerciales aplicables y trigger real de revisión:
  - Camino permitido elimina 149; quedan 973 productos; conserva todas las
    huellas fuera del alcance y revision pasa de 1 a 23.
  - Cambiar una fila QA produce `H171_PRECHECK_FAILED`; rollback conserva 987 productos.
  - Enlazar la venta real a un producto QA produce
    `H171_UNSELECTED_COMMERCIAL_REFERENCE`; rollback conserva 987 productos.
  - Alterar un contador durante el ensayo produce
    `H171_OUT_OF_SCOPE_CHANGE: folio_counters`; rollback conserva 987 productos.
- El ensayo local sustituyó únicamente las comprobaciones del catálogo remoto
  y el contexto/recibos Auth para aislar el algoritmo relacional. **No certifica
  los fences Auth en una ejecución destructiva remota**. Esos fences permanecen
  activos en el SQL preparado; cualquier rechazo abortará sin retirada parcial.
- Se detectó y corrigió una dependencia de la zona horaria del proceso local:
  PGlite arrancaba GMT-7. UTC reproduce las huellas del servidor.
- [Restauración comercial contrastada](h171-commercial-backup-roundtrip.md):
  149/149 filas seleccionadas y 35/35 tablas completas, 1,940 filas, reproducen
  las huellas originales remotas con tipos reales y UTC/ISO. No se recalcularon
  los resultados esperados desde la copia local. El SQL de 149 filas no cambió.

## Exclusiones y decisión pendiente

Se preservan los 2,520 objetos Storage (todos del propietario comercial; ninguna
pertenencia QA demostrada), las 11 cuentas Auth y sus identidades/sesiones, las
52 auditorías capability ligadas a actores QA, los recibos online/de cuenta,
config_commits, el expediente pendiente `70549527-4867-4342-94d2-38e770b0f2a9`,
las instalaciones/historia técnica y tres asignaciones de rol QA no incluidas.
Su retención o retirada exacta requiere un alcance técnico independiente dentro
de H171, con respaldo y aprobación propios de la acción destructiva.

También se preservan tres clientes dinámicos y una promoción del ensayo H148
con trazabilidad incompleta. Dos clientes fueron modificados después desde un
dispositivo real. El dueño debe clasificar esas cuatro filas antes de proponer
su retirada; no se infiere propiedad QA sólo por el texto.

La primera consulta XML de FKs de Auth fue inválida por XPath incompatible y sus
NULL no acreditan cero filas. Los conteos directos posteriores encontraron
auditorías restrictivas en seis actores y dependencias CASCADE en las cinco
cuentas creadas. Una dependencia existente no acredita por sí misma el fallo
pendiente de cuenta; éste conserva su expediente.

La aprobación destructiva original y la ampliación puntual al archivo con
contexto de mantenimiento ya se recibieron y ejecutaron. El retiro técnico
respaldado y de Auth demostrado continúa dentro de H171 bajo la instrucción
del OWNER; las cuatro filas ambiguas quedan para decisión individual al final.

# H171 — Reconciliación por lectura del journal

Implementado en `h171-live-reconciliation.mjs`; pendiente de commit. No se
modificó el runner, la aplicación ni la puerta live. Este componente no realiza
RPC, escrituras, limpieza ni reenvío. Recibe clientes ya creados y comprueba su
origen BALAM y el esquema `pos` antes de consultar:

```js
const reconciler = createLiveReconciler({
  db, admin, expectedProjectRef: project, expectedActorId: userId,
  protectedAuthIds: [], // Usar la lista explícita del expediente del dueño.
});
const reconciliation = await reconciler.reconcile({
  snapshot: mutationJournal.snapshot(), fixtures,
});
```

Se validan ejecución, actor, manifiesto y cadena de hashes antes de los reads.
El `fixture-plan` previo al transporte se valida por run, nueve UUIDs de
productos, los dos IDs exactos de la jornada UI, familia, existencias `[3,2]`
y precio `116`. Exige el contexto Node sin actor/HTTP del plan guardado por el
runner. Sólo produce `METADATA_ONLY`: no exporta filas, dispositivos, folios ni
recibos a partir de esos IDs, no atribuye escrituras y no afirma un ACK. Una
repetición idéntica al reabrir el run conserva ese significado; cualquier
metadata ajena o distinta se rechaza antes de consultar la autoridad.
Cada recibo comercial se consulta por actor y request ID; se cotejan estado,
respuesta y hash del comando según la representación `jsonb::text` de
PostgreSQL. Confirmado, rechazado y cancelado son resultados terminales
distintos. Ausencia, ejecución pendiente, otro actor o contenido distinto
conservan `reconciled:false`. Un resolver confirmado necesita el comando
original del journal; nunca se llama a `resolve_online_request` desde aquí.

Una cuenta creada se identifica por recibo, target UUID, hash de correo y
marcador Auth exacto; el correo por sí solo no acredita procedencia. También se
verifica el request interno de perfil derivado por el Edge vigente, incluso si
el navegador perdió el ACK y no guardó el UUID. El principal requiere su UUID
manifestado y marcador de ejecución. Las identidades protegidas quedan
bloqueadas. Perfiles, roles, retiro y dispositivos comprueban su estado final
por identidad; ese resultado se etiqueta `OBSERVED_FINAL_STATE`, sin afirmar
que el cliente recibió un ACK. La rotación de contraseña permanece
`UNVERIFIABLE_CREDENTIAL_CHANGE`: no es demostrable con estos reads.

El resultado exporta request IDs, Auth UUIDs acreditados, dispositivos,
asignaciones de folio monotónicas y PK de padres/hijos observados, incluidos
recibos internos, pagos, movimientos, commits y permisos compuestos. Detecta
filas que cambian entre dos lecturas y bloquea una página de 1000 filas, que
podría estar truncada por PostgREST. Los candidatos comerciales mantienen
`ownership:UNCLASSIFIED`; los hashes de filas corresponden a la proyección JSON
leída, sin credenciales, y no sustituyen el hash canónico del backup SQL.

[Prueba local ejecutada: 23/23 PASS](live-reconciliation.json). Incluye PGlite
para cotejar la canonicalización con PostgreSQL real, el helper de identidad
extraído del Edge actual, pérdida de ACK, actor/estado/hash incorrectos,
preparaciones de cuenta abandonadas, Auth protegido, lotes, permisos, cambios
concurrentes, truncamiento y dos casos de metadata previa a la jornada UI.
No hubo solicitudes a Supabase real.

Límites: `reconciled:true` solo acredita los tipos soportados y resultados
observados de ese snapshot. No es un snapshot transaccional ni acredita que los
emisores estén detenidos. Tipos desconocidos, operaciones globales fuera del
alcance y cuentas distintas de creación no reciben aprobación implícita.
Siempre se conservan `certified:false`, `cleanupVerified:false` y
`cleanupManifestComplete:false`. La futura limpieza requiere detener emisores,
cerrar referencias, backup canónico y guardas de actor/contenido que preserven
actividad real concurrente y contadores monotónicos.

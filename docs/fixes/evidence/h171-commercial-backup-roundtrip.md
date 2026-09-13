# H171 — Roundtrip tipado del respaldo comercial

Fecha UTC: 2026-09-13T03:14:25.727Z. **PASS: 149/149 filas seleccionadas y 35/35 tablas
comerciales restauran las huellas originales obtenidas del servidor.**
Filas comerciales totales: 1940. No se detectó pérdida de escala numérica
que altere `to_jsonb(fila)::text` en este respaldo específico.

Respaldo privado:
`.evidence-h171-private/commercial-backup.json`.
SHA256 verificado:
`6a6c9b084af4432c22f313a5bb908ab54a9e1104c47ba6ea09b597252d92d825`.

La comparación usa dos autoridades anteriores a esta prueba:

- Las 149 PK y MD5 originales de
  [dry-run remoto v2](h171/cleanup-dry-run-v2-before.json), campo `report.scope`.
- Las 35 huellas completas y conteos originales del
  [censo remoto](h171/authority-audit-before.json), campo
  `report.commercial_fingerprints`.

No se sustituyeron los hashes esperados por hashes recalculados después de
cargar el respaldo. Cada fila restaurada debía conservar su PK original y
`md5(to_jsonb(fila)::text)` igual al valor remoto. La prueba positiva anterior
de limpieza también exigía esos 149 hashes originales en su precheck;
su comparación posterior de filas ajenas usaba además una captura local
dentro de la transacción. Esta prueba adicional compara las 35 tablas completas
contra sus hashes remotos originales.

## Método

PGlite PostgreSQL 18.3 (PGlite 0.5.8), en memoria, sin conexión remota.
Se recrearon las columnas con los tipos exactos del catálogo real y las claves
primarias obtenidas del servidor. Se leyó el JSON privado mediante JSON.parse,
se transfirió cada tabla con JSON.stringify y se restauró mediante
`jsonb_populate_recordset(NULL::pos.tabla, $1::jsonb)`.
Esta ruta ejerce deliberadamente el roundtrip numérico de JavaScript.

Zona horaria UTC y DateStyle ISO, MDY antes de importar. Tras cargar los datos,
todas las verificaciones se ejecutaron dentro de `BEGIN READ ONLY`.
No se ejecutó DELETE; no se modificó el SQL comercial aprobado; llamadas
remotas: cero. No se imprimieron cuerpos comerciales.

La huella completa por tabla se calculó con el algoritmo original:

```sql
md5(coalesce(
  string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)),
  ''
))
```

## Resultado completo

| Tabla | Filas | Huella original = restaurada |
|---|---:|---|
| `clients` | 19 | `084b63281b5eb9f06fd14446a6a4c4fb` |
| `commission_adjustments` | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `config_commits` | 66 | `c7d983f24c0230ee8da93fe5d5bcf2f6` |
| `config_sync_state` | 1 | `e0ad5eb807237196efb419368dad86fc` |
| `exchange_commits` | 2 | `5372ccee46a6f1923da66346c0bfcf0d` |
| `exchange_items` | 4 | `00369ee53c1f874afb6ece36f7647f02` |
| `exchanges` | 2 | `37b8da98b4a1795f3be2d931fde354fc` |
| `folio_counters` | 3 | `b4639e121d23f951d9db30eb9642fe32` |
| `layaway_liquidation_commits` | 2 | `656f683d69a9df168e56f163aff7a9df` |
| `liquidations` | 2 | `54810d8d2595be65f17927087159d847` |
| `loan_documents` | 2 | `298169159e19bf796352f00458c089dc` |
| `lookup` | 552 | `cd57be24c198f56cf83c35617b3db299` |
| `movements` | 18 | `20177d1edcec49e8f2ccc1f1c5469d0b` |
| `permission_roles` | 2 | `839b7ebb616d253e6f3f06129c694759` |
| `physical_card_redemptions` | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `products` | 987 | `53d361aed4f026c8ff53487964061599` |
| `promotions` | 8 | `d5c8017c06b9501b5e137536fac7f6f2` |
| `reference_reclassifications` | 2 | `63d518710bb33cbc4c750fd21618a11f` |
| `return_commits` | 2 | `2154b45dac22a78fbd882bd4fbd7d62b` |
| `return_items` | 2 | `b7dd92abb568dbf92a724e94bfaa478b` |
| `returns` | 2 | `518f336c05ec7937a06ac49f07adf973` |
| `role_capability_permissions` | 31 | `f4e0c82e264ad5513068c9c69c532aff` |
| `role_screen_permissions` | 44 | `4e4e18a9a74a2e8ec41631a40b475ed1` |
| `sale_commits` | 12 | `2c9ad918a7d6e8ca5b03c426380319d0` |
| `sale_items` | 8 | `52033868eedd3c69e54b2ff11af1d200` |
| `sale_payments` | 14 | `98e50b9ebc41b7eaef296fc6038e629f` |
| `sales` | 8 | `b31c17adc57a7e6ad22704752153d21d` |
| `screen_permission_catalog` | 22 | `738869ef1e1002dcad7e9e05089b0b3d` |
| `screen_permission_catalog_state` | 1 | `08625ca802d4e29bf98d35d1cd3eeda5` |
| `sellers` | 32 | `3ee940d4aaf592c809230dd980a19561` |
| `settings` | 46 | `4a2952ac06e6bcb58309d0f780eff612` |
| `stock_reservations` | 8 | `1a1be5e83fe5e8253e28a0382b1dc7ae` |
| `user_capability_overrides` | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `user_permission_role_assignments` | 9 | `b11ad3c9e2759175efb5f519f1484d08` |
| `user_screen_permission_overrides` | 27 | `a5c06d1f59a452cd195fc627777728a5` |

Los 149 registros seleccionados distribuidos en 23 tablas conservan su hash
individual. Fallos individuales: **0**.

El subconjunto comercial protegido conserva 973 productos, 251 familias y
3,483 piezas; huella por orden de ID:
`f9e21666ec904d536d7e7273b581cf09`, idéntica al resultado remoto.

Esta conclusión corresponde exclusivamente al respaldo comercial con el SHA256
indicado. No se extrapola al respaldo técnico/Auth ni a futuras exportaciones
JSON; éstos requieren su propia comprobación de roundtrip o exportación canónica
como texto.

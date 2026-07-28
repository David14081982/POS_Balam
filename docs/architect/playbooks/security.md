---
capa: reglas+aprendizaje
applies_to: [security, migrations, database]
related_histories: [H-05, H-07, H-08, H-35]
severity_max: blocking
no_alcance: "No describe el contrato de autorización. Eso vive en docs/02-architecture.md § Autorización del esquema pos."
---

# Playbook · Seguridad, permisos y roles

## Reglas

**R-SEC-01 · BLOCKING · Toda relación nueva en `pos` exige revisar cinco cosas.**
ACL efectiva del objeto · `ALTER DEFAULT PRIVILEGES` del esquema · revoke
**nominal** a `authenticated` y `anon`, no sólo a `public` · `security_invoker`
en las vistas · interacción real con el RLS de las tablas subyacentes.
Origen: H-35 · Antipatrones: `AP-02`, `AP-03`

**R-SEC-02 · BLOCKING · Toda función `SECURITY DEFINER` exige cuatro cosas.**
Necesidad justificada · `search_path` fijo · permisos mínimos (nunca `execute`
a `authenticated` si no tiene guarda propia) · prueba de acceso negativo.
Origen: H-07 (`is_active_admin()`), H-35 · Antipatrón: `AP-04`

**R-SEC-03 · BLOCKING · Verde en local no es evidencia de una defensa remota.**
Toda contención se prueba contra la base real. En H-35 el defecto de permisos
sólo apareció al aplicar la verificación sobre la base.

**R-SEC-04 · BLOCKING · Si una verificación falla en remoto: detener.**
Detener commit y despliegue · preservar la evidencia del fallo · determinar si
hubo exposición activa · corregir con una migración **nueva**, no editando la
que ya se aplicó.
Origen: H-35

**R-SEC-05 · BLOCKING · `service_role` nunca en el navegador.**
Se reserva a infraestructura de servidor: omite RLS.
Origen: H-05 · Decisión: `ADR-005`

**R-SEC-06 · REQUIRED · La matriz de roles es obligatoria en todo cambio de
autorización.**
`anon` · `authenticated` sin perfil · vendedor activo · administrador activo ·
administrador inactivo · `service_role`. Se prueban lectura y escritura.
Origen: H-07, H-08

**R-SEC-07 · REQUIRED · Ocultar pantallas no es autorización.**
La interfaz y el servidor aplican el mismo contrato; filtrar el menú sin
respaldo en RLS no protege nada.
Origen: H-08 · Decisión: `ADR-005`

---

## Antipatrones

### AP-02 · `revoke ... from public` asumido suficiente ante privilegios por defecto
**Origen:** H-35 · **Estado:** vigente · **Severidad:** BLOCKING
**Contexto:** se crea una relación nueva en un esquema que tiene privilegios por
defecto instalados.
**Síntoma:** el objeto queda legible por `authenticated` pese al `revoke`.
**Causa raíz:** el esquema `pos` tiene `defaclobjtype 'r' → authenticated=arwdDxtm`,
de modo que **toda relación nueva** se concede automáticamente a ese rol. El
`revoke ... from public` retira el permiso de `PUBLIC`, no el concedido
nominalmente. Para funciones no existe ese privilegio por defecto en `pos`, y
por eso el mismo `revoke` sí bastó en `pos.sale_line_balance()`: **tablas y
funciones no se comportan igual ante `alter default privileges`**, y trasladar
el razonamiento de una a otra fue el error.
**Riesgo:** exposición de datos comerciales a cualquier cuenta autenticada,
debilitando la contención de H-07 y H-08.
**Regla permanente:** `R-SEC-01`.
**Cómo detectarlo:** `has_table_privilege('authenticated', '<objeto>', 'select')`
inmediatamente después de crear el objeto, en la misma transacción.
**Cómo prevenirlo:** revoke nominal a `authenticated` y `anon` además de
`public`, y grant explícito sólo al rol que debe leer.
**Pruebas obligatorias:** la verificación debe abortar si cualquiera de los dos
roles conserva el privilegio.
**Excepciones justificables:** objetos cuya lectura por `authenticated` sea
deliberada y esté protegida por RLS.
**Referencias:** `supabase/migrations/20260728004900_pos_h35_line_balance_grants.sql`
**Camino de retiro:** un arnés que recorra todas las relaciones de `pos` y falle
si alguna concede a `anon` o a `authenticated` sin declararlo.

### AP-03 · Vista sin `security_invoker` que evade el RLS de sus tablas
**Origen:** H-35 · **Estado:** vigente · **Severidad:** BLOCKING
**Contexto:** una vista se define sobre tablas protegidas por RLS.
**Síntoma:** ninguno visible mientras los permisos estén bien; el agujero
aparece la próxima vez que alguien recree el objeto.
**Causa raíz:** por omisión la vista se ejecuta con los permisos de su dueño, de
modo que el RLS de las tablas subyacentes no se aplica a quien la consulta.
**Riesgo:** un privilegio por defecto futuro vuelve a abrir la exposición y esta
vez sin barrera de fondo. Es la diferencia entre cerrar la puerta y quitar la
cerradura.
**Regla permanente:** `R-SEC-01`.
**Cómo detectarlo:** leer `reloptions` del objeto y exigir
`security_invoker = true`.
**Cómo prevenirlo:** declararlo al crear la vista, no en una migración posterior.
**Pruebas obligatorias:** la verificación exige revoke **y** `security_invoker`;
debe fallar si decae cualquiera de los dos.
**Excepciones justificables:** una vista que deliberadamente debe saltarse RLS,
con la justificación escrita en el `comment on view`.
**Referencias:** `supabase/migrations/20260728004900_pos_h35_line_balance_grants.sql`
**Camino de retiro:** el mismo arnés de `AP-02`, ampliado a `reloptions`.

### AP-04 · `SECURITY DEFINER` concedido a `authenticated` sin guarda propia
**Origen:** H-35 (detectado antes de aplicar) · **Estado:** vigente · **Severidad:** BLOCKING
**Contexto:** una función interna necesita leer tablas protegidas y se le
concede `execute` al rol de la aplicación «para que funcione».
**Síntoma:** la función responde correctamente y nadie nota que responde a
cualquiera.
**Causa raíz:** `SECURITY DEFINER` sin guarda de permiso convierte a la función
en un puente alrededor del RLS.
**Riesgo:** en H-35, cualquier cuenta autenticada —incluida una sin perfil en
`pos.sellers`— habría podido leer las cantidades de cualquier folio.
**Regla permanente:** `R-SEC-02`.
**Cómo detectarlo:** por cada función `SECURITY DEFINER`, comprobar si tiene
guarda propia (`pos.is_active_admin() or pos.is_active_seller()`) o si su
`execute` está limitado a `service_role`.
**Cómo prevenirlo:** decidir explícitamente si la función es interna o pública.
Si es interna, `execute` sólo a `service_role` y sus llamadores son otras
funciones y las migraciones.
**Pruebas obligatorias:** acceso negativo real —`set role authenticated` debe
recibir `42501`— y la verificación aborta si el privilegio reaparece.
**Excepciones justificables:** funciones con guarda propia comprobada, como
`pos.reserve_folio_block()`.
**Referencias:** `docs/fixes/saldo-por-renglon.md` § 6
**Camino de retiro:** un arnés que enumere las funciones `SECURITY DEFINER` de
`pos` y exija de cada una guarda propia o `execute` restringido.

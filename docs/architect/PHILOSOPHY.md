---
capa: filosofia
applies_to: [todo]
severity_max: recommended
no_alcance: "No son reglas: no tienen severidad y no se verifican. Orientan cuando no existe una regla específica."
---

# Filosofía de ingeniería

Nueve principios. No bloquean nada y no se marcan como cumplidos. Sirven
exactamente cuando no hay una regla aplicable, que es cuando un agente
improvisa mal.

**1. Modelamos conceptos del negocio, no implementaciones.**
Un folio es una referencia comercial; un `operation_id` es identidad técnica.
Un solo campo cumpliendo dos funciones incompatibles fue el defecto de H-33.

**2. Una pregunta de negocio tiene una sola autoridad.**
Si está respondida en dos lugares, uno de los dos se equivocará algún día, y
nadie lo notará mientras coincidan.

**3. Persistimos evidencia; derivamos cálculos.**
Lo pactado con el cliente vive en el documento, no en la configuración vigente.
Un ticket emitido debe seguir siendo explicable dentro de diez años.

**4. Preferimos extensión antes que modificación.**
Una costura declarada (H-35) y una redefinición estrictamente aditiva (H-34)
valen más que un cambio elegante que toca a todos los consumidores.

**5. Toda solución debe facilitar el siguiente cambio, no sólo resolver el
actual.**
La costura de extensión de H-35 nació de esta idea: la fase que resolvía el
saldo no implementaba cambios, pero dejó el único punto por donde entrarán.
H-34 redefinió `commit_sale` de forma estrictamente aditiva para que la fase
siguiente no tuviera que reescribirla, y H-33 reservó bloques de folios para
que una terminal offline no dependiera de una decisión futura. Una solución que
resuelve hoy y obliga a tocar a todos los consumidores mañana no está
terminada: trasladó el trabajo, no lo hizo.

**6. Lo aplicado no se reescribe: se corrige hacia adelante.**
Vale para migraciones, para folios impresos, para ventas confirmadas y para
este propio sistema.

**7. Funciona sin red y sobrevive a un reintento.**
Si una acción no puede completarse offline y dejar una operación recuperable e
idempotente, todavía no está diseñada.

**8. La evidencia manda sobre la intención.**
Verde en local no demuestra una defensa remota. Dar por desplegada una
migración no la despliega (H-31).

**9. Toda decisión importante debe poder justificarse dentro de cinco años.**
Si no puede, no está lista para tomarse. Por eso existen los ADR, y por eso
cada uno registra su costo y no sólo su beneficio.

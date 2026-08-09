# Prototipo aislado H-89

Demuestra si Chrome acepta un Web App Manifest y sus iconos cuando todos se
materializan en runtime dentro de Cache Storage y son servidos por el service
worker bajo el scope real `/POS_Balam/`.

Este directorio no se carga desde `POS Balam.html`, `index.html` ni
`build-offline.mjs`. No modifica la aplicación productiva.

La prueba intencionalmente no incluye un manifest estático. Registra el worker,
espera control efectivo, genera un logo fuente de 1024 px, deriva PNG 192, 512 y
maskable 512, escribe primero los recursos y finalmente añade el enlace al
manifest virtual. De ese modo cualquier resultado positivo incluye la condición
de carrera que H-89 necesita resolver.

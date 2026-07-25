# Trazabilidad financiera

## Fuente de verdad

- `sales.total`: valor final de la operación, con IVA incluido.
- `sales.subtotal` + `sales.iva`: desglose fiscal histórico.
- `sales.descuento`: descuento total concedido.
- `sale_payments`: entradas reales de dinero; una fila por cobro.
- `returns`: salidas de dinero por devolución.

Un apartado puede tener un anticipo, varios abonos y una liquidación. La suma de
sus pagos determina lo cobrado; `sales.saldo` conserva lo pendiente. Inventario
y comisión se reconocen una sola vez, cuando el saldo llega a cero.

## Compatibilidad histórica

No se generan pagos artificiales para ventas anteriores. Cuando una venta no
tiene snapshot o movimientos de pago, la interfaz la marca como histórica con
desglose incompleto. Su total persistido y su capacidad de devolución se
conservan.

## Pago mixto

Cada movimiento identifica por separado efectivo, tarjeta, transferencia y
otro. La suma de componentes debe coincidir exactamente con el monto.

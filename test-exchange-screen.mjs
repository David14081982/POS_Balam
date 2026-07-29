// test-exchange-screen.mjs — H-42 (C6): la pantalla del Cambio.
//
// Contrato bajo prueba:
//   • El tipo de operación se elige al inicio; Devoluciones queda INTACTA.
//   • El motivo se reutiliza en ambos flujos; el método de reembolso es
//     exclusivo de Devoluciones y no aparece en el cambio.
//   • La pantalla consume las autoridades y no reimplementa ninguna regla.
//   • La diferencia usa el checkout completo del POS y el comprobante es
//     `window.BalamTicket`: no hay un segundo formato de impresión.
//   • El vendedor que atiende y la revisión de la prenda quedan registrados.
//
// Uso: node test-exchange-screen.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? '✅' : '❌'} ${n}${d ? ` · ${d}` : ''}`); c ? pass++ : fail++; };
const read = (r) => { try { return readFileSync(new URL(r, import.meta.url), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return ''; } };
const ret = read('./balam/returns.jsx');
const tk = read('./balam/pos-ticket.jsx');
const dataSrc = read('./balam/data.jsx');
const store = read('./balam/store.jsx');
const mig = read('./supabase/migrations/20260729006300_pos_h42_exchange_seller_review.sql');
const ver = read('./supabase/migrations/20260729006400_pos_h42_exchange_seller_review_verification.sql');

console.log('\n── A) Entrada y flujo de Devoluciones intacto ───────────');
ok('1. el tipo de operación se elige al inicio', /Tipo de operación/.test(ret) && /OPERACIONES/.test(ret));
ok('2. ofrece Devolución y Cambio', /\['devolucion', 'Devolución'\]/.test(ret) && /\['cambio', 'Cambio'\]/.test(ret));
ok('3. existe la pantalla del cambio', /function ExchangeDetail\(/.test(ret));
ok('4. ReturnDetail sigue existiendo sin absorber el cambio',
  /function ReturnDetail\(/.test(ret)
    && !/function ReturnDetail\([\s\S]{0,4000}recordExchange/.test(ret));
ok('5. el método de reembolso sigue siendo exclusivo de Devoluciones',
  (ret.match(/Método de reembolso/g) || []).length === 1
    && !/function ExchangeDetail\([\s\S]*?Método de reembolso/.test(ret.slice(ret.indexOf('function ExchangeDetail'))));
ok('6. el motivo se reutiliza en ambos flujos',
  (ret.match(/C\.list\('return_reason'\)/g) || []).length === 2);

console.log('\n── B) La pantalla consume autoridades, no reglas ────────');
const ex = ret.slice(ret.indexOf('function ExchangeDetail'));
ok('7. el disponible sale de saleLineBalance', /D\.saleLineBalance\(sale\.folio\)/.test(ex));
ok('8. el valor reconocido sale de recognizedValue', /D\.recognizedValue\(sale\.folio/.test(ex));
ok('9. el precio de lo que se lleva sale de listPrice y priceRange',
  /D\.listPrice\(/.test(ex) && /D\.priceRange\(/.test(ex));
ok('10. el plazo sale de la autoridad de H-34', /deadlineOf\(sale\)/.test(ex) && /vencida/.test(ex));
ok('11. el registro pasa por recordExchange y por nada más',
  /D\.recordExchange\(/.test(ex) && !/pushExchange|commit_exchange/.test(ex));
ok('12. no recalcula el saldo con una resta propia',
  !/returnedQty|sale\.lineas[\s\S]{0,80}reduce[\s\S]{0,80}qty\s*-/.test(ex));

console.log('\n── C) Cobro, vendedor y revisión ───────────────────────');
ok('13. la diferencia usa el checkout completo del POS', /window\.CheckoutModal/.test(ex));
ok('14. pide el vendedor que atiende el cambio',
  /SellerModal/.test(ex) && /vendedorId: sellerId/.test(ex));
ok('15. usa la elegibilidad comercial de H-29', /isEligibleSeller/.test(ex));
ok('16. exige la revisión de cada prenda recibida',
  /Registra la revisión de/.test(ex) && /revisadoPor: revisor/.test(ex));
// El aviso del sobrante es del SISTEMA, no del navegador. Se comprueba que no
// queda ninguna LLAMADA a window.confirm —el parentesis distingue la llamada de
// la mencion en un comentario, que antes hacia pasar esta prueba por accidente.
ok('17. advierte del sobrante con el modal del sistema, no con window.confirm',
  /no se devuelve en efectivo/i.test(ex) && !/window\.confirm\(/.test(ex)
    && /cambio-aviso-confirmar/.test(ex) && /cambio-aviso-revisar/.test(ex));
ok('18. no ofrece devolver efectivo en ningún punto',
  !/reembolso|devolver dinero/i.test(ex));

console.log('\n── D) Comprobante: una sola autoridad ──────────────────');
ok('19. el comprobante es window.BalamTicket', /window\.BalamTicket/.test(ex));
ok('20. no se define un segundo formato de impresión',
  !/tk-block|80mm|balam-ticket/.test(ex));
ok('21. BalamTicket acepta el cambio como costura', /function BalamTicket\(\{ sale, payment, exchange \}\)/.test(tk));
ok('22. el ticket imprime lo que entrega y lo que recibe',
  /'Entrega'/.test(tk) && /'Recibe'/.test(tk) && /Cambio de mercancia/.test(tk));
ok('23. el ticket declara el sobrante no reembolsable', /no reembolsable/.test(tk));
ok('24. la costura de apartados sigue intacta', /payment \? h\('div', \{ key: 'rc'/.test(tk));

console.log('\n── E) Modelo y esquema ─────────────────────────────────');
ok('25. recordExchange acepta vendedor y revisión',
  /vendedorId, revisadoPor/.test(dataSrc) && /condicion: l\.lado === 'devuelto'/.test(dataSrc));
ok('26. STORE transporta los tres campos nuevos',
  /vendedor_id: exch\.vendedorId/.test(store) && /revisado_por: exch\.revisadoPor/.test(store)
    && /condicion: l\.condicion/.test(store));
ok('27. la migración es aditiva y nullable',
  /add column if not exists vendedor_id/.test(mig) && /add column if not exists revisado_por/.test(mig)
    && /add column if not exists condicion/.test(mig)
    && !/drop table|truncate|not null/i.test(mig.split('comment on')[0].split('alter table')[1] || ''));
ok('28. commit_exchange transporta los campos nuevos',
  /p_exchange ->> 'vendedor_id'/.test(mig) && /x\.condicion/.test(mig));
ok('29. la verificación prueba transporte y compatibilidad',
  /raise exception/.test(ver) && /sin los campos nuevos/.test(ver) && /delete from pos\.exchanges/.test(ver));

console.log('\n── F) Panel de resumen, al estilo del POS ──────────────');
ok('30. hay un panel lateral con el ancho del ticket del POS',
  /Resumen del cambio/.test(ex) && /w-\[clamp\(340px/.test(ex));
ok('31. el panel muestra las dos mitades del cambio',
  /'Entrega'/.test(ex) && /'Recibe'/.test(ex));
ok('32. cada renglón trae imagen, cantidad y papelera',
  /ProductImage/.test(ex) && /onMenos/.test(ex) && /onMas/.test(ex) && /onQuitar/.test(ex));
ok('33. se puede quitar lo marcado por error en ambos lados',
  /quitarDev/.test(ex) && /entQuitar/.test(ex));
ok('34. el pie navy lleva el desglose del POS',
  /bg-primary text-on-primary/.test(ex) && /Importe/.test(ex) && /IVA \(/.test(ex));
ok('35. distingue cobrar de valor no aprovechado',
  /Diferencia a cobrar/.test(ex) && /Valor no aprovechado/.test(ex)
    && /No se devuelve en efectivo ni queda a favor/.test(ex));
ok('36. hay estado vacío en ambos bloques', (ex.match(/vacio\(/g) || []).length >= 2);
ok('37. el renglón nuevo se ilumina como en el POS',
  /flashLine/.test(ex) && /ring-2 ring-success/.test(ex));
// H-44: el boton ya no es un callejon sin salida. Solo el plazo vencido lo
// deshabilita; en cualquier otro estado responde y dice que falta, y `validar()`
// sigue siendo la unica autoridad que decide si se registra.
ok('38. el botón principal guía en vez de quedar muerto',
  /const guia = vencida \?/.test(ex) && /disabled: vencida,/.test(ex)
    && /guia \? guia\.txt :/.test(ex) && /if \(!validar\(\)\)/.test(ex));
ok('38b. la preselección de motivo y condición es visible y editable',
  /motivo: motivoDefault, condicion: CONDICIONES\[0\]/.test(ex)
    && /'data-testid': 'cambio-motivo'/.test(ex) && /'data-testid': 'cambio-condicion'/.test(ex)
    && /onChange: e => setRow\(r\.k, \{ motivo: e\.target\.value \}\)/.test(ex)
    && /onChange: e => setRow\(r\.k, \{ condicion: e\.target\.value \}\)/.test(ex));
ok('38c. el revisor se prellena con la sesión y sigue editable',
  /sesion\.nombre \|\| sesion\.email/.test(ex) && /onChange: e => setRevisor\(e\.target\.value\)/.test(ex));
ok('39. lee código de barras igual que el Punto de venta',
  /BARCODES && window\.BARCODES\.find\(raw\)/.test(ex) && /BARCODES\.parse\(raw\)/.test(ex)
    && /addEventListener\('keydown'/.test(ex) && /now - lt > 50/.test(ex));
ok('40. el comprobante se imprime automáticamente al cerrar',
  /setTimeout\(\(\) => window\.print\(\), 350\)/.test(ex));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);

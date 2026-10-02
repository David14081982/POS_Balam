// H-182/H-183. Local USB preference and diagnostics without creating a sale.
(function () {
  const h = React.createElement;
  const { useEffect, useRef, useState } = React;
  const COPY_LABELS = ['COPIA CLIENTE', 'COPIA TIENDA'];
  const ticketsPending = () => !!window.PrintManager?.history().some(job => !['COMPLETED', 'CANCELLED', 'FAILED'].includes(job.stage));
  function USBPrintCheck() {
    const usb = window.USBReceipt;
    const [state, setState] = useState(() => usb.snapshot());
    const [working, setWorking] = useState(false);
    const [preparing, setPreparing] = useState(false);
    const [note, setNote] = useState('');
    const [managerBusy, setManagerBusy] = useState(ticketsPending);
    const session = useRef({ mounted: true, generation: 0, active: false, controller: null, releaseDemo: null });
    window.UI.useSyncActivity(working || state.busy, ['config'], { screen: 'usb-print-check' });

    useEffect(() => {
      const current = session.current;
      current.mounted = true;
      const unsubscribe = usb.subscribe(() => { if (current.mounted) setState(usb.snapshot()); });
      const unsubscribeManager = window.PrintManager?.subscribe?.(() => { if (current.mounted) setManagerBusy(ticketsPending()); });
      setState(usb.snapshot());
      setManagerBusy(ticketsPending());
      return () => {
        const releaseConnection = current.active || !usb.snapshot().enabled;
        current.mounted = false; current.generation++;
        current.controller?.abort(); current.releaseDemo?.();
        unsubscribe(); unsubscribeManager?.();
        // A pending native chooser cannot be dismissed by JavaScript. Its late
        // answer is invalidated. An idle, enabled commercial connection belongs
        // to the session, so navigating back to POS must leave it available.
        if (releaseConnection) Promise.resolve(usb.disconnect()).catch(() => {});
      };
    }, [usb]);

    function run(action, recovery = false) {
      const current = session.current;
      if (!current.mounted || current.active || usb.snapshot().busy || (!recovery && ticketsPending())) return;
      current.active = true;
      const generation = ++current.generation;
      current.controller = new AbortController();
      const valid = () => current.mounted && current.generation === generation && !current.controller?.signal.aborted;
      current.rendering = false; setWorking(true); setNote('');
      let result;
      try {
        // In particular connect() reaches requestDevice in this user gesture.
        result = action({ current, valid, signal: current.controller.signal });
      } catch (error) { result = Promise.reject(error); }
      Promise.resolve(result).catch(error => {
        if (valid()) setNote(current.rendering ? 'No se pudo preparar el ticket de prueba. Vuelve a intentarlo; no se enviaron datos a la impresora.'
          : String(error?.code || '').startsWith('USB_') ? error.message
            : usb.snapshot().message || 'No se pudo completar la prueba. Revisa la conexión USB y vuelve a conectar.');
      }).finally(() => {
        if (!valid()) return;
        current.releaseDemo?.(); current.controller = null; current.active = false;
        setWorking(false); setPreparing(false); setState(usb.snapshot());
      });
    }

    function disconnect() {
      const current = session.current;
      if (!current.mounted || ticketsPending()) return;
      const generation = ++current.generation;
      current.controller?.abort(); current.releaseDemo?.(); current.controller = null;
      current.active = true; setWorking(true); setPreparing(false); setNote('');
      Promise.resolve().then(() => usb.disconnect()).catch(() => {
        if (current.mounted && current.generation === generation) setNote('No se pudo liberar la conexión. Desconecta el cable USB antes de volver a conectar.');
      }).finally(() => {
        if (!current.mounted || current.generation !== generation) return;
        current.active = false; setWorking(false); setState(usb.snapshot());
      });
    }

    function printTicket({ current, valid, signal }) {
      if (!usb.snapshot().connected || usb.snapshot().resetRequired) return;
      if (document.querySelector('#balam-ticket, #balam-return-receipt')) {
        setNote('Cierra el comprobante abierto antes de imprimir esta prueba.'); return;
      }
      current.rendering = true; setPreparing(true);
      const folio = 'PRUEBA-USB-' + crypto.randomUUID();
      const sale = {
        folio, fecha: new Date().toLocaleString('es-MX'), vendedor: 'PRUEBA USB',
        cliente: 'SIN VALOR COMERCIAL', metodo: 'Prueba USB', estado: 'Pagado',
        total: 116, subtotal: 100, iva: 16, ivaPct: 16, ivaIncluded: true, descuento: 0, saldo: 0,
        lineas: [{ nombre: 'PRUEBA USB · SIN VALOR COMERCIAL', sku: 'PRUEBA-USB', talla: 'M', qty: 1, precio: 116,
          ornamento: 'Comprobación de texto e imagen', ornColors: ['NEGRO'] }],
      };
      const host = document.createElement('div');
      host.dataset.usbReceiptFixture = 'true'; document.body.append(host);
      const root = ReactDOM.createRoot(host);
      let released = false;
      current.releaseDemo = () => {
        if (released) return;
        released = true; root.unmount(); host.remove(); current.releaseDemo = null;
      };
      let snapshots;
      try {
        ReactDOM.flushSync(() => root.render(h(window.BalamTicket, { sale })));
        const element = Array.from(document.querySelectorAll('#balam-ticket')).find(node => node.dataset.documentId === folio);
        if (!element) throw new Error('USB_DEMO_NOT_MOUNTED');
        // Both documents and their styles are frozen before the first await.
        snapshots = COPY_LABELS.map(label => window.UI.captureReceipt(element, label));
      } finally { current.releaseDemo?.(); }
      return (async () => {
        const images = [];
        for (const snapshot of snapshots) {
          if (!valid()) return;
          images.push(await window.UI.receiptGraphic(snapshot, () => {}, signal));
        }
        if (!valid()) return;
        current.rendering = false; setPreparing(false);
        await usb.printImages(images);
      })();
    }

    function setEnabled(value) {
      if (working || usb.snapshot().busy || ticketsPending()) return;
      setNote('');
      try { usb.setEnabled(value); }
      catch (error) { setNote(error.message || 'No se pudo guardar la conexión de este dispositivo.'); }
    }

    const connectionBusy = working || state.busy;
    const busy = connectionBusy || managerBusy;
    const canPrint = state.supported && state.connected && !busy && !state.resetRequired;
    const status = note || (preparing ? 'Preparando las copias de prueba…' : state.message)
      || (state.connected ? 'Impresora USB conectada.' : 'Conecta la impresora USB para comenzar.');
    const button = (id, label, action, disabled) => h('button', {
      key: id, type: 'button', 'data-testid': id, onClick: action, disabled,
      className: 'min-h-11 px-4 py-2 border border-outline-variant rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed',
    }, label);
    const diagnostics = {
      supported: state.supported, enabled: !!state.enabled, connected: state.connected, busy: !!busy,
      phase: state.phase, resetRequired: !!state.resetRequired,
      device: state.device ? {
        name: state.device.name, vendorId: state.device.vendorId, productId: state.device.productId,
        configuration: state.device.configuration, interfaceNumber: state.device.interfaceNumber,
        alternateSetting: state.device.alternateSetting, endpoint: state.device.endpoint,
      } : null,
      lastJob: state.lastJob ? {
        result: state.lastJob.result, physicalPrintConfirmed: false,
        bytesSent: state.lastJob.bytesSent, copiesSent: state.lastJob.copiesSent, errorCode: state.lastJob.errorCode,
        copies: (state.lastJob.copies || []).map(copy => ({ width: copy.width, height: copy.height })),
      } : null,
    };
    return h(window.HX.GlassCard, { className: 'p-6', 'data-testid': 'usb-print-check' }, [
      h(window.HX.SerifHeading, { key: 'title', className: 'mb-2', children: 'Impresión por USB en este dispositivo' }),
      h('label', { key: 'mode', className: 'flex items-center gap-3 min-h-11 mb-2' }, [
        h('input', { key: 'toggle', type: 'checkbox', 'data-testid': 'usb-use-for-tickets', checked: !!state.enabled,
          disabled: busy || (!state.enabled && (!state.supported || !state.connected || state.resetRequired)),
          onChange: event => setEnabled(event.target.checked), className: 'w-5 h-5 shrink-0 accent-primary' }),
        h('span', { key: 'label', className: 'text-body font-semibold' }, 'Usar USB para los tickets de este dispositivo'),
      ]),
      h('p', { key: 'mode-description', className: 'text-caption text-on-surface-variant mb-3' }, state.enabled
        ? 'Los tickets de este dispositivo se envían por USB, sin abrir THERMER ni Guardar como PDF. La conexión se conserva al volver a Ventas. Al reabrir BALAM, vuelve a conectar la impresora.'
        : 'Conecta y prueba la impresora; después activa esta opción para imprimir los tickets habituales por USB. Este ajuste no cambia la impresión de las otras computadoras.'),
      h('p', { key: 'description', className: 'text-caption text-on-surface-variant' },
        'Imprime una prueba sin registrar una venta. El ticket conserva el diseño y tamaño de 80 mm, con una copia para cliente y otra para tienda.'),
      !state.supported && h('p', { key: 'unsupported', className: 'mt-3 text-caption' },
        window.isSecureContext ? 'Este navegador no permite conectar impresoras por USB. Abre BALAM en Chrome de la tablet.'
          : 'La conexión USB necesita abrir BALAM desde su dirección segura HTTPS.'),
      h('p', { key: 'instructions', className: 'mt-3 text-caption text-on-surface-variant' },
        'Mantén BALAM abierto durante la prueba. Android puede pedir permiso al conectar o reconectar la impresora.'),
      state.resetRequired && h('p', { key: 'reset', role: 'alert', className: 'mt-3 text-caption text-danger' },
        'El envío se interrumpió y pudo quedar incompleto. Desconecta la conexión, apaga y enciende físicamente la impresora; después confirma abajo antes de volver a conectar. El ticket no se repite automáticamente.'),
      managerBusy && h('p', { key: 'pending-tickets', role: 'status', className: 'mt-3 text-caption' },
        'Hay tickets pendientes. Puedes recuperar la conexión; termina o cancela esos trabajos antes de usar las pruebas o cambiar el modo de impresión.'),
      h('p', { key: 'status', 'data-testid': 'usb-status', role: 'status', className: 'mt-3 text-body' }, status),
      state.device && h('p', { key: 'device', className: 'mt-1 text-caption text-on-surface-variant' }, state.device.name || 'Dispositivo USB seleccionado'),
      h('div', { key: 'actions', className: 'mt-4 flex flex-wrap gap-2' }, [
        button('usb-connect', 'Conectar impresora USB', () => run(() => usb.connect(), true), !state.supported || connectionBusy || state.connected || state.resetRequired),
        button('usb-disconnect', busy ? 'Cancelar y desconectar' : 'Desconectar', disconnect, managerBusy || (!busy && !state.connected)),
        button('usb-test-text', 'Imprimir texto de prueba', () => run(() => usb.printText()), !canPrint),
        button('usb-test-ticket', 'Imprimir dos tickets de prueba', () => run(printTicket), !canPrint),
        state.resetRequired && button('usb-reset-ack', 'Ya apagué y encendí la impresora', () => run(() => usb.acknowledgeReset(), true), connectionBusy || state.connected),
      ]),
      h('details', { key: 'diagnostics', className: 'mt-4 text-caption', 'data-testid': 'usb-diagnostics' }, [
        h('summary', { key: 'summary' }, 'Ver detalles de la conexión'),
        h('p', { key: 'limit', className: 'mt-2' }, 'Los datos enviados no confirman que haya salido papel.'),
        h('pre', { key: 'json', className: 'mt-2 whitespace-pre-wrap break-all' }, JSON.stringify(diagnostics, null, 2)),
      ]),
    ]);
  }
  window.USBPrintCheck = USBPrintCheck;
})();

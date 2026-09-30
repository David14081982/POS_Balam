// H-153. Output only: no DATA/STORE writes, financial rules or ticket templates.
(function () {
  const UI = window.UI;
  const jobs = [], listeners = new Set();
  const terminal = job => ['COMPLETED', 'CANCELLED', 'FAILED'].includes(job.stage);
  let active = null, sequence = 0;
  const notices = new WeakMap();
  function notice(host, message) {
    if (host === window || host.closed) { UI.toast(message); return; }
    let node = host.document.getElementById('receipt-print-status');
    if (!node) {
      node = host.document.createElement('div'); node.id = 'receipt-print-status';
      (host.document.querySelector('.tools') || host.document.body).after(node);
    }
    node.textContent = message; node.setAttribute('role', 'status');
    node.style.cssText = 'padding:12px;background:white;color:#131b2e;font:14px Arial';
  }
  const stamp = () => new Date().toISOString();
  const times = { CREATED: 'createdAt', DATA_READY: 'dataReadyAt', RENDER_STARTED: 'renderStartedAt', ASSETS_READY: 'assetsReadyAt', RENDER_FINISHED: 'renderFinishedAt', PAYLOAD_READY: 'payloadReadyAt', QUEUED: 'queuedAt', SEND_STARTED: 'sendStartedAt', HANDOFF_FINISHED: 'handoffFinishedAt', COMPLETED: 'completedAt', FAILED: 'failedAt' };
  const publicJob = job => ({ ...job.audit, stage: job.stage, events: job.events.map(e => ({ ...e })) });
  function changed() { listeners.forEach(fn => fn()); }
  function stage(job, value, details = {}) {
    // Asset promises may settle after cancellation. Only an explicit retry can
    // reopen a terminal job; late renderer events must never resurrect it.
    if (terminal(job) && value !== 'QUEUED') return;
    const timestamp = stamp();
    job.stage = value;
    Object.assign(job.audit, details, times[value] ? { [times[value]]: timestamp } : {});
    const entry = { stage: value, timestamp, ...details };
    job.events.push(entry);
    if (job.events.length > 100) job.events.shift();
    // Deliberately exclude content, names, images, resource URLs and raw exceptions.
    console.info('[PRINT_AUDIT]', { ...job.audit, stage: value, timestamp });
    if (value === 'FAILED') notice(job.host, job.message);
    if (value === 'PAYLOAD_READY') notice(job.host, 'Ticket listo para imprimir.');
    changed();
  }
  function release(job) {
    if (job.controller) job.controller.abort();
    if (job.cleanup) job.cleanup();
    job.cleanup = null;
    if (job.frame) job.frame.remove();
    job.frame = null;
    if (active === job) active = null;
  }
  function finish(job, result) {
    if (terminal(job)) return;
    stage(job, 'HANDOFF_FINISHED', { result });
    stage(job, 'COMPLETED', { physicalPrintConfirmed: false });
    release(job);
    job.resolve(publicJob(job));
    job.snapshot = null; job.payload = null;
    pump();
  }
  function failed(job, error) {
    if (terminal(job)) return;
    // Error stacks may contain data URIs / URLs; retain only engine frames.
    const errorStack = String(error.stack || '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 6).map(line => line.replace(/(?:https?:|blob:|data:)[^\s)]+/g, '[resource]')).join('\n');
    job.message = /^El (comprobante|diseño)/.test(error.message || '') ? error.message : 'No se pudo enviar el ticket. Intenta nuevamente.';
    stage(job, 'FAILED', { result: 'NOT_HANDED_OFF', errorCode: error.code || 'PRINT_PREPARATION_OR_TRANSPORT', errorStack });
    release(job); job.resolve(publicJob(job)); pump();
  }
  function pump() {
    if (active) return;
    active = jobs.find(job => !terminal(job)) || null;
    if (!active) { changed(); return; }
    if (active.ready) {
      stage(active, 'WAITING_TURN');
      if (active.audit.transport === 'browser' && active.automatic) send(active);
    }
    changed();
  }
  function send(job) {
    if (!job || job !== active || !job.ready || job.stage === 'SEND_STARTED' || terminal(job)) return false;
    // H-180: the OS and its installed print services select the printer.
    // The browser owns this dialog; no app package or USB device is assumed.
    stage(job, 'SEND_STARTED', { result: 'HANDOFF_REQUESTED' });
    try {
      const host = job.frame.contentWindow;
      let returned = false, after = false;
      const ended = () => { after = true; if (returned) finish(job, 'BROWSER_DIALOG_FINISHED'); };
      host.addEventListener('afterprint', ended);
      job.cleanup = () => host.removeEventListener('afterprint', ended);
      host.focus(); host.print(); returned = true;
      if (after) finish(job, 'BROWSER_DIALOG_FINISHED');
      return true;
    } catch (error) { failed(job, error); return false; }
  }
  async function prepare(job) {
    try {
      job.controller = new AbortController();
      if (!job.snapshot.text.trim()) throw new Error('El comprobante está vacío. Cierra y vuelve a abrirlo.');
      stage(job, 'RENDER_STARTED');
      job.frame = await UI.receiptFrame(job.snapshot, { continuous: job.continuous, audit: (value, details) => stage(job, value, details), signal: job.controller.signal });
      job.frame.dataset.printJobId = job.audit.printJobId;
      job.payload = job.frame.contentDocument.documentElement.outerHTML;
      stage(job, 'RENDER_FINISHED', { pageWidth: job.continuous ? 80 : null, pageHeight: Number(job.frame.dataset.pageHeight) || null });
      if (terminal(job)) { release(job); return; }
      const [documentHash, renderHash, payloadHash] = await Promise.all([
        UI.receiptHash(job.snapshot.html), job.audit.renderHash || UI.receiptHash(job.payload), UI.receiptHash(job.payload),
      ]);
      if (terminal(job)) { release(job); return; }
      if (job.audit.payloadHash && job.audit.payloadHash !== payloadHash) throw new Error('El comprobante preparado cambió. Cierra y vuelve a abrirlo.');
      stage(job, 'PAYLOAD_READY', { documentHash, renderHash, payloadHash, payloadLength: job.payload.length });
      job.ready = true;
      if (job === active) {
        stage(job, 'WAITING_TURN');
        if (job.audit.transport === 'browser' && job.automatic) send(job);
      }
      changed();
    } catch (error) { failed(job, error); }
  }
  function enqueue({ element, host = window, automatic = false, copies = 1, copyLabels = null, source, documentType, continuous = true } = {}) {
    element = element || host.document.querySelector('#balam-ticket, #balam-return-receipt');
    if (!element) { UI.toast('El comprobante todavía no está disponible. Cierra y vuelve a abrirlo.'); return null; }
    const transport = 'browser';
    if (!Number.isInteger(copies) || copies < 1 || copies > 50) { UI.toast('Selecciona entre 1 y 50 copias.'); return null; }
    const key = element.outerHTML;
    const existing = jobs.find(job => job.element === element && job.key === key && job.audit.transport === transport && (!terminal(job) || automatic));
    if (existing) { if (!automatic) send(existing); return existing.handle; }
    if (jobs.filter(job => !terminal(job)).length + copies > 50) { UI.toast('Hay varios tickets esperando. Termina o cancela los pendientes antes de agregar más.'); return null; }
    // H-179: una copia marcada (COPIA CLIENTE / COPIA TIENDA) es un documento
    // congelado propio; las copias sin marca comparten el mismo.
    const variants = new Map();
    const variantFor = copyLabel => {
      if (variants.has(copyLabel)) return variants.get(copyLabel);
      let snapshot, initialError;
      try {
        snapshot = UI.captureReceipt(element, copyLabel);
      } catch (error) { initialError = error; snapshot = { html: key, css: '', text: '' }; }
      const variant = { snapshot, initialError };
      variants.set(copyLabel, variant);
      return variant;
    };
    if (host !== window && !notices.has(host)) {
      const node = host.document.createElement('div'); node.dataset.printControls = 'true';
      node.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;z-index:10;max-height:45vh;overflow:auto';
      host.document.body.append(node);
      const root = ReactDOM.createRoot(node); root.render(React.createElement(PrintStatus));
      notices.set(host, root);
      host.addEventListener('pagehide', () => { root.unmount(); notices.delete(host); }, { once: true });
      const css = host.document.createElement('style'); css.textContent = '@media print{[data-print-controls]{display:none!important}}'; host.document.head.append(css);
    }
    const batch = [];
    for (let copyNumber = 1; copyNumber <= copies; copyNumber++) {
      const printJobId = `print-${Date.now().toString(36)}-${++sequence}`;
      const copyLabel = copyLabels ? copyLabels[copyNumber - 1] || null : null;
      const { snapshot, initialError } = variantFor(copyLabel);
      const job = { element, key, host, continuous, automatic: true, snapshot: { ...snapshot }, initialError,
        stage: 'CREATED', ready: false, frame: null, cleanup: null, events: [], payload: null,
        audit: { ...Object.fromEntries(Object.values(times).map(name => [name, null])), payloadLength: null, pixelWidth: null, pixelHeight: null, pageWidth: null, pageHeight: null,
          printJobId, source: source || element.dataset.printSource || 'receipt', ticketId: element.dataset.documentId || null,
          documentType: documentType || element.dataset.documentType || (element.id === 'balam-return-receipt' ? 'return' : 'receipt'),
          copyNumber, totalCopies: copies, copyLabel, transport, printerTarget: 'system-dialog',
          result: null, errorCode: null, errorStack: null, physicalPrintConfirmed: false } };
      job.promise = new Promise(resolve => { job.resolve = resolve; });
      job.handle = Object.freeze({ printJobId, done: job.promise });
      jobs.push(job); batch.push(job);
      stage(job, 'CREATED'); stage(job, 'DATA_READY'); stage(job, 'QUEUED');
    }
    while (jobs.length > 100) {
      const index = jobs.findIndex(terminal);
      if (index < 0) break;
      jobs.splice(index, 1);
    }
    pump(); batch.forEach(job => {
      if (job.initialError) failed(job, job.initialError);
      else prepare(job);
    });
    return batch[0].handle;
  }
  function cancel(id) {
    const job = jobs.find(j => j.audit.printJobId === id);
    // Cannot retract an already delivered native print job.
    if (!job || terminal(job) || job.stage === 'SEND_STARTED') return false;
    stage(job, 'CANCELLED', { result: 'CANCELLED_BEFORE_SEND' });
    release(job); job.resolve(publicJob(job)); pump(); return true;
  }
  function retry(id) {
    const job = jobs.find(j => j.audit.printJobId === id);
    if (!job || job.stage !== 'FAILED') return false;
    job.ready = false;
    job.promise = new Promise(resolve => { job.resolve = resolve; });
    job.audit.errorCode = null; job.audit.errorStack = null;
    stage(job, 'QUEUED', { result: 'EXPLICIT_RETRY' });
    pump(); prepare(job);
    return true;
  }
  function PrintStatus() {
    const [, refresh] = React.useReducer(n => n + 1, 0);
    React.useEffect(() => { listeners.add(refresh); return () => listeners.delete(refresh); }, []);
    const job = active || [...jobs].reverse().find(j => j.stage === 'FAILED' && !j.dismissed);
    if (!job) return null;
    const sending = job.stage === 'SEND_STARTED';
    // H-179: con dos copias el operador ve cuál sigue (p. ej. «COPIA TIENDA · 2 de 2»).
    const copy = job.audit.totalCopies > 1 ? ` ${job.audit.copyLabel || 'Copia'} · ${job.audit.copyNumber} de ${job.audit.totalCopies}.` : '';
    const message = (job.stage === 'FAILED' ? job.message : sending
      ? 'Cierra el diálogo de impresión para continuar.'
      : job.ready ? 'Ticket listo para imprimir.' : 'Preparando ticket…') + copy;
    const button = (id, label, action) => React.createElement('button', { key: id, type: 'button', 'data-testid': id,
      onClick: event => { if (event.detail <= 1) action(); }, style: { minHeight: 44, padding: '8px 12px', border: '1px solid #abb2c0', borderRadius: 8, background: 'white', color: '#131b2e', fontWeight: 600 }, className: 'min-h-[44px] px-3 py-2 border rounded-lg font-semibold' }, label);
    return React.createElement('section', { 'data-testid': 'print-status', className: 'bg-white text-primary p-3 rounded-xl shadow-e3 max-w-full sm:max-w-sm', style: { position: 'fixed', top: 12, right: 12, width: 'min(360px, calc(100vw - 24px))', zIndex: 200, pointerEvents: 'auto', padding: 12, background: 'white', color: '#131b2e', borderRadius: 12, maxHeight: '45vh', overflow: 'auto' } }, [
      React.createElement('p', { key: 'status', role: 'status', className: 'text-sm' }, message),
      React.createElement('div', { key: 'buttons', style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }, className: 'flex flex-wrap gap-2 mt-2' }, [
        job.ready && !sending && !terminal(job) && button('print-next', 'Imprimir ticket', () => send(job)),
        !sending && !terminal(job) && button('print-cancel', 'Cancelar', () => cancel(job.audit.printJobId)),
        sending && button('print-returned', 'Ya cerré el diálogo', () => finish(job, 'USER_CONFIRMED_RETURN')),
        job.stage === 'FAILED' && button('print-retry', 'Reintentar', () => retry(job.audit.printJobId)),
        job.stage === 'FAILED' && button('print-dismiss', 'Cerrar aviso', () => { job.dismissed = true; changed(); }),
      ]),
      jobs.filter(j => !terminal(j)).length > 1 && React.createElement('p', { key: 'pending', className: 'text-sm mt-2' }, 'Hay otro ticket esperando.'),
      UI.technicalMessageViewer() && React.createElement('details', { key: 'audit', className: 'text-xs mt-2' }, [
        React.createElement('summary', { key: 'label' }, 'Ver detalles técnicos'),
        React.createElement('pre', { key: 'data', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 200, overflow: 'auto' } }, JSON.stringify(jobs.slice(-10).map(publicJob), null, 2)),
      ]),
    ]);
  }
  function PrintHistory() {
    const [, refresh] = React.useReducer(n => n + 1, 0);
    React.useEffect(() => { listeners.add(refresh); return () => listeners.delete(refresh); }, []);
    if (!UI.technicalMessageViewer()) return null;
    return React.createElement('details', { 'data-testid': 'print-history', className: 'p-4 bg-white rounded-xl' }, [
      React.createElement('summary', { key: 'title' }, 'Historial reciente de impresión'),
      React.createElement('p', { key: 'limit', className: 'text-sm my-2' }, 'Sólo esta sesión. La entrega al sistema no confirma la salida en papel.'),
      React.createElement('ul', { key: 'rows', style: { maxHeight: 320, overflow: 'auto' } }, jobs.slice(-30).reverse().map(job => React.createElement('li', { key: job.audit.printJobId, style: { padding: '8px 0', borderBottom: '1px solid #d9dde5', overflowWrap: 'anywhere' } },
        `${new Date(job.audit.createdAt).toLocaleTimeString()} · ${job.audit.ticketId || 'Reporte'} · copia ${job.audit.copyNumber}/${job.audit.totalCopies} · Sistema · ${job.stage === 'FAILED' ? 'No enviado' : job.stage === 'CANCELLED' ? 'Cancelado' : job.stage === 'COMPLETED' ? 'Interacción finalizada' : 'Pendiente'}`))),
      React.createElement('details', { key: 'technical' }, [
        React.createElement('summary', { key: 'title' }, 'Ver detalles técnicos'),
        React.createElement('pre', { key: 'data', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 400, overflow: 'auto' } }, JSON.stringify(jobs.slice(-30).map(publicJob), null, 2)),
      ]),
    ]);
  }
  window.PrintManager = { enqueue, cancel, retry, sendNext: () => send(active),
    acknowledgeReturn: () => active && active.stage === 'SEND_STARTED' ? finish(active, 'USER_CONFIRMED_RETURN') : false,
    history: () => jobs.map(publicJob), PrintStatus, PrintHistory };
})();

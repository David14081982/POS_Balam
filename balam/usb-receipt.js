// H-182: opt-in diagnostic transport. No commercial writes or automatic replay.
(function () {
  const usb = navigator.usb;
  const supported = !!(window.isSecureContext && usb && typeof usb.requestDevice === 'function');
  const listeners = new Set(), pending = new Set(), closingTokens = new Set();
  let connection = null, operation = null, blockedCleanup = null, lastDevice = null, closing = 0, sequence = 0;
  const state = { phase: 'DISCONNECTED', message: 'Conecta la impresora USB para comenzar la prueba.', resetRequired: false, cleanupRequired: false, lastJob: null };
  const error = (code, message) => Object.assign(new Error(message), { code });
  const cancelled = () => error('USB_CANCELLED', 'Se canceló la prueba USB.');
  const changed = () => listeners.forEach(fn => fn());
  const busy = () => !!operation || !!blockedCleanup || closing > 0 || pending.size > 0;
  const snapshot = () => ({ ...state, supported, connected: !!connection, busy: busy(),
    device: lastDevice ? { ...lastDevice } : null,
    lastJob: state.lastJob ? { ...state.lastJob, copies: state.lastJob.copies.map(copy => ({ ...copy })) } : null });
  function update(phase, message) { state.phase = phase; state.message = message; changed(); }
  function check(token) { if (operation !== token || token.cancelled) throw cancelled(); }
  function idle() {
    if (busy()) throw error('USB_BUSY', 'Espera a que termine la prueba o se libere la conexión USB.');
    if (state.resetRequired) throw error('USB_RESET_REQUIRED', 'Apaga y enciende la impresora antes de volver a conectarla.');
  }
  async function closeDevice(token) {
    if (!token?.device) return;
    if (token.closing) return token.closing;
    closing++; closingTokens.add(token); changed();
    // close() aborts pending transfers and releases claimed interfaces. Do not
    // wait for a hung transfer before closing, or reuse an unresolved device.
    token.closing = Promise.resolve().then(() => token.device.close()).then(() => {
      if (blockedCleanup === token) { blockedCleanup = null; state.cleanupRequired = false; }
    }).catch(() => {
      if (token.detached) return;
      // A rejected close is not evidence that the interface was released.
      // Retain ownership and prohibit another job until cleanup or unplug.
      blockedCleanup = token; state.cleanupRequired = true;
      update('ERROR', 'No se pudo liberar la conexión. Desconecta físicamente el cable USB antes de volver a conectar.');
    }).finally(() => {
      closing--; closingTokens.delete(token); token.closing = null; changed();
    });
    return token.closing;
  }
  async function nativeCall(token, start) {
    check(token);
    // Call immediately: requestDevice must retain the user's activation.
    const work = Promise.resolve(start());
    pending.add(work);
    let timer;
    const tracked = work.then(async value => {
      if (token.cancelled && token.device) await closeDevice(token);
      return value;
    }).finally(() => { pending.delete(work); changed(); });
    try {
      return await Promise.race([tracked, new Promise((_, reject) => {
        timer = setTimeout(() => {
          token.cancelled = true;
          reject(error('USB_TIMEOUT', 'La impresora no respondió a tiempo. Revisa el cable y la conexión.'));
        }, 30000);
      })]);
    } finally { clearTimeout(timer); }
  }
  function selectInterface(device) {
    const candidates = [];
    for (const config of device.configurations || []) {
      for (const face of config.interfaces || []) {
        for (const alternate of face.alternates || []) {
          if (![7, 255].includes(alternate.interfaceClass)) continue;
          const outputs = (alternate.endpoints || []).filter(endpoint => endpoint.type === 'bulk' && endpoint.direction === 'out');
          for (const endpoint of outputs) candidates.push({ configuration: config.configurationValue,
            interfaceNumber: face.interfaceNumber, alternateSetting: alternate.alternateSetting,
            endpoint: endpoint.endpointNumber, interfaceClass: alternate.interfaceClass });
        }
      }
    }
    const printer = candidates.filter(candidate => candidate.interfaceClass === 7);
    const options = printer.length ? printer : candidates;
    if (options.length !== 1) throw error('USB_INTERFACE', options.length
      ? 'La impresora ofrece varias salidas USB. Guarda los detalles de la prueba para revisar su compatibilidad.'
      : 'Este dispositivo no ofrece una salida USB de impresora compatible con esta prueba.');
    return options[0];
  }
  async function connect() {
    idle();
    if (!supported) throw error('USB_UNAVAILABLE', 'Esta prueba requiere BALAM por HTTPS y un navegador con WebUSB, como Chrome en Android.');
    if (connection) return snapshot();
    if (navigator.userActivation && !navigator.userActivation.isActive) throw error('USB_GESTURE', 'Pulsa Conectar impresora USB para autorizarla.');
    const token = { kind: 'connect', device: null, cancelled: false, issued: false };
    operation = token; update('CONNECTING', 'Selecciona la END-80TEUX y permite que Chrome acceda por USB.');
    try {
      // A device chooser is user-controlled: no 30-second deadline on the user.
      const device = await usb.requestDevice({ filters: [{ classCode: 7 }, { classCode: 255 }] });
      check(token);
      token.device = device;
      lastDevice = { name: device.productName || 'Impresora USB', vendorId: device.vendorId, productId: device.productId };
      const selected = selectInterface(device);
      Object.assign(lastDevice, selected);
      await nativeCall(token, () => device.open()); check(token);
      if (device.configuration?.configurationValue !== selected.configuration) {
        await nativeCall(token, () => device.selectConfiguration(selected.configuration)); check(token);
      }
      await nativeCall(token, () => device.claimInterface(selected.interfaceNumber)); check(token);
      const current = device.configuration?.interfaces.find(face => face.interfaceNumber === selected.interfaceNumber)?.alternate;
      if (!current || current.alternateSetting !== selected.alternateSetting) {
        await nativeCall(token, () => device.selectAlternateInterface(selected.interfaceNumber, selected.alternateSetting)); check(token);
      }
      connection = { device, ...selected };
      update('CONNECTED', 'Impresora conectada. Ya puedes enviar la prueba.');
      return snapshot();
    } catch (cause) {
      token.cancelled = true; await closeDevice(token);
      const failure = cause.name === 'NotFoundError' && !token.device ? error('USB_SELECTION_CANCELLED', 'No se seleccionó ninguna impresora.')
        : cause.code ? cause : error('USB_CONNECTION', 'No se pudo abrir la impresora USB. Cierra otras aplicaciones de impresión y revisa el permiso y el cable.');
      if (!state.cleanupRequired) update(state.resetRequired ? 'RESET_REQUIRED' : 'DISCONNECTED', failure.message);
      throw failure;
    } finally { if (operation === token) operation = null; changed(); }
  }
  async function disconnect(detachedDevice = null) {
    const token = operation || blockedCleanup || (connection && { device: connection.device });
    connection = null;
    if (token) {
      token.cancelled = true;
      if (token.device === detachedDevice) token.detached = true;
      if (token.issued && state.lastJob) {
        state.resetRequired = true; state.lastJob.result = 'UNCERTAIN';
      }
    }
    update(state.resetRequired ? 'RESET_REQUIRED' : 'DISCONNECTED', state.resetRequired
      ? 'El envío pudo quedar incompleto. Apaga y enciende la impresora antes de otra prueba.' : 'Impresora desconectada.');
    await closeDevice(token);
    return snapshot();
  }
  function acknowledgeReset() {
    if (busy() || connection) throw error('USB_BUSY', 'Espera a que se libere la conexión USB.');
    state.resetRequired = false;
    update('DISCONNECTED', 'Vuelve a conectar la impresora USB para realizar otra prueba.');
  }
  async function bitmap(png, token) {
    if (typeof png !== 'string' || !png.startsWith('data:image/png;base64,') || png.length > 500000) {
      throw error('USB_IMAGE', 'No se pudo preparar la imagen del ticket.');
    }
    const image = new Image(); image.src = png;
    await image.decode(); check(token);
    const width = image.naturalWidth, height = image.naturalHeight;
    if (width !== 576 || !Number.isInteger(height) || height < 1 || height > 24000) {
      throw error('USB_IMAGE_SIZE', 'La imagen no corresponde al ticket actual de 80 mm. No se cambió su tamaño.');
    }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const data = new Uint8Array(width / 8 * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722 < 128) {
          data[y * (width / 8) + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
      return { width, height, data };
    } finally { canvas.width = 0; canvas.height = 0; image.src = ''; }
  }
  async function run(kind, prepare) {
    idle();
    if (!connection) throw error('USB_NOT_CONNECTED', 'Conecta la impresora USB antes de imprimir.');
    const token = { kind, device: connection.device, endpoint: connection.endpoint, cancelled: false, issued: false };
    operation = token;
    const job = { id: 'usb-' + (++sequence), kind, result: 'NOT_SENT', physicalPrintConfirmed: false,
      bytesSent: 0, copiesSent: 0, copies: [], createdAt: new Date().toISOString() };
    state.lastJob = job; update('PREPARING', 'Preparando la prueba USB…');
    async function write(bytes) {
      check(token); token.issued = true;
      const result = await nativeCall(token, () => token.device.transferOut(token.endpoint, bytes));
      if (result && Number.isInteger(result.bytesWritten)) job.bytesSent += Math.max(0, Math.min(bytes.length, result.bytesWritten));
      check(token);
      if (!result || result.status !== 'ok' || result.bytesWritten !== bytes.byteLength) {
        throw error('USB_PARTIAL', 'La impresora no aceptó todos los datos.');
      }
    }
    try {
      const copies = await prepare(token); check(token);
      job.copies = copies.map(copy => ({ width: copy.width || null, height: copy.height || null }));
      update('SENDING', 'Enviando a la impresora USB. Mantén BALAM abierta.');
      await write(new Uint8Array([0x1b,0x40, 0x1b,0x61,0, 0x1d,0x4c,0,0, 0x1d,0x57,0x40,0x02]));
      for (const copy of copies) {
        if (copy.text) await write(new TextEncoder().encode(copy.text));
        else {
          const stride = copy.width / 8;
          for (let row = 0; row < copy.height; row += 32) {
            const rows = Math.min(32, copy.height - row), bytes = new Uint8Array(8 + stride * rows);
            bytes.set([0x1d,0x76,0x30,0, stride & 255,stride >> 8,rows & 255,rows >> 8]);
            bytes.set(copy.data.subarray(row * stride, (row + rows) * stride), 8);
            await write(bytes);
          }
        }
        // No LF between raster bands; advance only at the end of each copy.
        await write(new Uint8Array([0x1b,0x64,3, 0x1d,0x56,0x42,0]));
        job.copiesSent++; changed();
      }
      job.result = 'TRANSFERRED'; job.finishedAt = new Date().toISOString();
      update('DELIVERED', 'Datos enviados por USB. Comprueba que la prueba salió completa en papel.');
      return snapshot();
    } catch (cause) {
      token.cancelled = true; connection = null;
      job.result = token.issued ? 'UNCERTAIN' : 'NOT_SENT';
      state.resetRequired = state.resetRequired || token.issued;
      job.errorCode = cause.code || 'USB_TRANSFER'; job.finishedAt = new Date().toISOString();
      update(state.resetRequired ? 'RESET_REQUIRED' : 'ERROR', state.resetRequired
        ? 'El envío pudo quedar incompleto. Apaga y enciende la impresora antes de otra prueba.'
        : 'La prueba no se envió. Vuelve a conectar la impresora e inténtalo de nuevo.');
      await closeDevice(token);
      throw cause.code ? cause : error('USB_TRANSFER', state.message);
    } finally { if (operation === token) operation = null; changed(); }
  }
  const printText = () => run('text', async () => [{ text: 'PRUEBA USB BALAM\nSIN VALOR COMERCIAL\nFIN DE PRUEBA\n' }]);
  const printImages = images => run('ticket', async token => {
    if (!Array.isArray(images) || images.length !== 2) throw error('USB_COPIES', 'La prueba necesita las copias de cliente y tienda.');
    // Decode both before sending anything. No resizing or partial second copy.
    const copies = [];
    for (const png of images.slice()) copies.push(await bitmap(png, token));
    return copies;
  });
  usb?.addEventListener('disconnect', event => {
    for (const token of closingTokens) if (token.device === event.device) token.detached = true;
    if (event.device === connection?.device || event.device === operation?.device || event.device === blockedCleanup?.device) {
      if (operation?.device === event.device) operation.detached = true;
      if (blockedCleanup?.device === event.device) {
        blockedCleanup.detached = true; blockedCleanup = null; state.cleanupRequired = false;
      }
      void disconnect(event.device);
    }
  });
  window.addEventListener('pagehide', () => { void disconnect(); });
  window.USBReceipt = { connect, disconnect, printText, printImages, snapshot, acknowledgeReset,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
})();

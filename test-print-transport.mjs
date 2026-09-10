// Test-only native boundary. Captures the document actually sent by an iframe;
// legacy top-level calls remain measurable. Never contacts an OS printer.
export function installPrintTransport({ counter = '__printed', hold = false } = {}) {
  window[counter] = 0;
  window.__printArtifacts = [];
  window.__holdPrint = hold;
  const install = host => {
    host.print = () => {
      window[counter]++;
      window.__printArtifacts.push({ html: host.document.documentElement.outerHTML,
        text: host.document.body.innerText, frameId: host.frameElement?.dataset.printJobId || null });
      host.dispatchEvent(new Event('beforeprint'));
      if (!window.__holdPrint) host.dispatchEvent(new Event('afterprint'));
    };
  };
  install(window);
  new MutationObserver(() => {
    document.querySelectorAll('iframe[data-print-job-id]').forEach(frame => {
      if (!frame.__printTest) { frame.__printTest = true; install(frame.contentWindow); }
    });
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-print-job-id'] });
}

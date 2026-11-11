(async () => {
  // Recheck the origin because the WebView may have navigated since the native
  // page-load callback was queued.
  const { protocol, hostname, port } = window.location;
  const isApp = protocol === 'tauri:' && hostname === 'localhost'
    || (protocol === 'http:' || protocol === 'https:') && hostname === 'tauri.localhost';
  if (!isApp || port || !navigator.serviceWorker) return;

  const scope = new URL('/', window.location.href).href;
  const scriptUrl = new URL('sw.js', scope).href;
  const registration = await navigator.serviceWorker.getRegistration(scope);
  if (!registration || registration.scope !== scope) return;

  const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
  if (!workers.length || workers.some((worker) => worker.scriptURL !== scriptUrl)) return;

  if (await registration.unregister()) window.location.reload();
})().catch(() => {
  // Some WebViews do not expose service workers for their application origin.
});

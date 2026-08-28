const CACHE_URLS_MESSAGE = "CACHE_URLS";

export async function registerServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  const readyRegistration = await navigator.serviceWorker.ready;
  const worker = readyRegistration.active ?? registration.active;
  if (!worker) return;

  const urls = new Set<string>([window.location.href]);
  for (const entry of performance.getEntriesByType("resource")) {
    const url = new URL(entry.name, window.location.href);
    if (url.origin === window.location.origin) urls.add(url.href);
  }
  worker.postMessage({ type: CACHE_URLS_MESSAGE, urls: [...urls] });
}

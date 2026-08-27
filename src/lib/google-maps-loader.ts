declare global {
  interface Window {
    __nycSolarMapsPromise?: Promise<void>;
  }
}

export function loadGoogleMaps(apiKey: string): Promise<void> {
  const googleGlobal = (window as typeof window & { google?: typeof google }).google;
  if (googleGlobal?.maps) return Promise.resolve();
  if (window.__nycSolarMapsPromise) return window.__nycSolarMapsPromise;

  window.__nycSolarMapsPromise = new Promise((resolve, reject) => {
    const callbackName = '__initNycSolarMaps';
    const callbackWindow = window as typeof window & Record<string, unknown>;
    callbackWindow[callbackName] = () => {
      delete callbackWindow[callbackName];
      resolve();
    };

    const script = document.createElement('script');
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      `&v=weekly&loading=async&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.append(script);
  });

  return window.__nycSolarMapsPromise;
}

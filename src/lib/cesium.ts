// CesiumJS is loaded as the prebuilt script copied to /public/cesium
// (scripts/copy-cesium.mjs) instead of being bundled: it is ~2000 modules
// plus web workers, and the prebuilt file loads much faster in dev.
import type * as CesiumModule from "cesium";

export type Cesium = typeof CesiumModule;

declare global {
  interface Window {
    Cesium?: Cesium;
    CESIUM_BASE_URL?: string;
  }
}

let pending: Promise<Cesium> | null = null;

export function loadCesium(): Promise<Cesium> {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (pending) return pending;

  pending = new Promise<Cesium>((resolve, reject) => {
    window.CESIUM_BASE_URL = "/cesium";

    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/cesium/Widgets/CesiumWidget/CesiumWidget.css";
    document.head.appendChild(css);

    const script = document.createElement("script");
    script.src = "/cesium/Cesium.js";
    script.async = true;
    script.onload = () => (window.Cesium ? resolve(window.Cesium) : reject(new Error("The globe engine did not start.")));
    script.onerror = () => {
      pending = null;
      script.remove();
      reject(new Error("Could not load the globe engine. Check your connection and reload."));
    };
    document.head.appendChild(script);
  });
  return pending;
}

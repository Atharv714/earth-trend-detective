// Cesium loads its web workers, star textures and styles at runtime from a
// public URL. Copy the prebuilt files into public/cesium (git-ignored).
// Runs after `npm install`.
import { cpSync, existsSync, rmSync } from "node:fs";

const from = "node_modules/cesium/Build/Cesium";
const to = "public/cesium";
if (existsSync(from)) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: (p) => !p.endsWith(".cjs") && !p.endsWith("index.js") });
  console.log("copied Cesium runtime to", to);
}

// MediaPipe's hand-tracking runtime (wasm), for hand control of the globe. The model
// (public/mediapipe/hand_landmarker.task) is committed, so it all works offline.
const mpFrom = "node_modules/@mediapipe/tasks-vision/wasm";
const mpTo = "public/mediapipe/wasm";
if (existsSync(mpFrom)) {
  rmSync(mpTo, { recursive: true, force: true });
  cpSync(mpFrom, mpTo, { recursive: true });
  console.log("copied MediaPipe wasm to", mpTo);
}

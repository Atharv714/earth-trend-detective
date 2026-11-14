// Cesium loads its web workers, star textures and styles at runtime from a
// public URL. Copy the prebuilt files into public/cesium (git-ignored).
// Runs after `npm install`.
import { cpSync, existsSync, rmSync } from "node:fs";

const from = "node_modules/cesium/Build/Cesium";
const to = "public/cesium";
if (!existsSync(from)) process.exit(0);
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true, filter: (p) => !p.endsWith(".cjs") && !p.endsWith("index.js") });
console.log("copied Cesium runtime to", to);

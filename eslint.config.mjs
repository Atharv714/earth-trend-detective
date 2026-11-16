import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Copied Cesium build (see next.config.ts), not our code.
    "public/cesium/**",
    "public/mediapipe/wasm/**",
    // Python voice service and its virtualenv.
    "voice/**",
    // bklit charts, added by `npx shadcn add @bklit/...` (components.json): library code, kept as shipped.
    "src/components/charts/**",
  ]),
]);

export default eslintConfig;

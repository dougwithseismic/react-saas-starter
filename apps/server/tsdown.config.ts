import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  deps: { alwaysBundle: [/^@repo\//] },
});

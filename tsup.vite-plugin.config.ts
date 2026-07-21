import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["./src/vite-plugin/index.ts"],
  outDir: "dist/vite-plugin",
  format: ["cjs", "esm"],
  dts: true,
  platform: "node",
  tsconfig: "tsconfig.vite-plugin.json",
  clean: false,
})

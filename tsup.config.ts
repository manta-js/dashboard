import { defineConfig } from "tsup"

export default defineConfig([
  {
    entry: ["./src/app.tsx"],
    format: ["cjs", "esm"],
    external: [
      "virtual:medusa/forms",
      "virtual:medusa/displays",
      "virtual:medusa/routes",
      "virtual:medusa/links",
      "virtual:medusa/menu-items",
      "virtual:medusa/widgets",
      "virtual:medusa/i18n",
      "virtual:dashboard/menu-config",
    ],
    tsconfig: "tsconfig.build.json",
    clean: true,
  },
  {
    entry: ["./src/vite-plugin/index.ts"],
    outDir: "dist/vite-plugin",
    format: ["cjs", "esm"],
    dts: true,
    platform: "node",
    tsconfig: "tsconfig.vite-plugin.json",
  },
])

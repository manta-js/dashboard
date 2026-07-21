import { defineConfig } from "tsup"

export default defineConfig({
    entry: {
      app: "./src/app.tsx",
      components: "./src/exports/components.ts",
      hooks: "./src/exports/hooks.ts",
    },
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
    dts: {
      entry: {
        index: "./src/index.ts",
        components: "./src/exports/components.ts",
        hooks: "./src/exports/hooks.ts",
      },
    },
    clean: true,
})

import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { createConsumerDashboardPlugin } from "./dashboard-plugin.mjs"

const packageRoot = dirname(
  fileURLToPath(import.meta.resolve("@medusajs/dashboard/package.json"))
)
const importer = join(packageRoot, "src/routes/orders/order-list/index.ts")
const shellTarget = join(
  packageRoot,
  "src/components/layout/shell/shell.tsx"
)
const shellImporter = join(
  packageRoot,
  "src/components/layout/shell/index.ts"
)
const dashboardPlugin = createConsumerDashboardPlugin({
  onSummary: (summary) =>
    writeFileSync("production-summary.json", `${JSON.stringify(summary)}\n`),
})

export default defineConfig({
  build: { outDir: "build" },
  plugins: [
    dashboardPlugin,
    {
      name: "packed-consumer-production-proof",
      async buildStart() {
        const canonicalShell = await this.resolve(
          "@mantajs/medusa-dashboard/shell"
        )
        const aliasedShell = await this.resolve("@medusajs/dashboard/shell")
        for (const resolvedShell of [canonicalShell, aliasedShell]) {
          if (!resolvedShell?.id.endsWith("src/exports/shell.ts")) {
            throw new Error(
              `public Shell did not resolve to the Dashboard source graph: ${resolvedShell?.id}`
            )
          }
        }

        const resolved = await this.resolve("./order-list", importer)
        if (!resolved?.id.endsWith("src/admin/components/orders/order-list.tsx")) {
          throw new Error(`production override did not resolve: ${resolved?.id}`)
        }

        const resolveHook =
          typeof dashboardPlugin.resolveId === "function"
            ? dashboardPlugin.resolveId
            : dashboardPlugin.resolveId.handler
        const resolvedShell = await resolveHook.call(
          { resolve: async () => ({ id: shellTarget }) },
          "./shell",
          shellImporter,
          { attributes: {}, isEntry: false }
        )
        if (!resolvedShell.endsWith("src/admin/components/shell.tsx")) {
          throw new Error(
            `production Shell override did not resolve: ${resolvedShell}`
          )
        }
      },
    },
  ],
})

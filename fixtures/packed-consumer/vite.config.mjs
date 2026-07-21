import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { createConsumerDashboardPlugin } from "./dashboard-plugin.mjs"

const packageRoot = dirname(
  fileURLToPath(import.meta.resolve("@medusajs/dashboard/package.json"))
)
const importer = join(packageRoot, "src/routes/orders/order-list/index.ts")
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
        const resolved = await this.resolve("./order-list", importer)
        if (!resolved?.id.endsWith("src/admin/components/orders/order-list.tsx")) {
          throw new Error(`production override did not resolve: ${resolved?.id}`)
        }
      },
    },
  ],
})

import { defineConfig } from "vite"
import { createConsumerDashboardPlugin } from "./dashboard-plugin.mjs"

export default defineConfig({
  build: { outDir: "stale-build" },
  plugins: [
    createConsumerDashboardPlugin({
      componentOverrides: [
        {
          override: "src/admin/components/orders/order-list.tsx",
          target: "src/routes/orders/order-list/missing.tsx",
        },
      ],
    }),
  ],
})

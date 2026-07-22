import { customDashboardPlugin } from "@mantajs/medusa-dashboard/vite-plugin"

export const componentOverrides = [
  {
    override: "src/admin/components/orders/order-list.tsx",
    target: "src/routes/orders/order-list/order-list.tsx",
  },
  {
    override: "src/admin/components/shell.tsx",
    target: "src/components/layout/shell/shell.tsx",
  },
]

export const createConsumerDashboardPlugin = (options = {}) =>
  customDashboardPlugin({ componentOverrides, ...options })

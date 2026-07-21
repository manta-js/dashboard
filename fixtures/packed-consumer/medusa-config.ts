import { createConsumerDashboardPlugin } from "./dashboard-plugin.mjs"

export default {
  admin: {
    vite: () => ({ plugins: [createConsumerDashboardPlugin()] }),
  },
}

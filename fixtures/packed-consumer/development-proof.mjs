import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  componentOverrides,
  createConsumerDashboardPlugin,
} from "./dashboard-plugin.mjs"

const packageRoot = dirname(
  fileURLToPath(import.meta.resolve("@medusajs/dashboard/package.json"))
)
const targetPath = join(packageRoot, componentOverrides[0].target)
const importer = join(packageRoot, "src/routes/orders/order-list/index.ts")
const plugin = createConsumerDashboardPlugin()
const resolveHook =
  typeof plugin.resolveId === "function"
    ? plugin.resolveId
    : plugin.resolveId.handler
const resolved = await resolveHook.call(
  { resolve: async () => ({ id: targetPath }) },
  "./order-list",
  importer,
  { attributes: {}, isEntry: false }
)
if (!resolved.endsWith("src/admin/components/orders/order-list.tsx")) {
  throw new Error(`declared override did not resolve: ${resolved}`)
}
if (resolved.includes("undeclared/order-list.tsx")) {
  throw new Error("undeclared same-name override was applied")
}

const buildEnd =
  typeof plugin.buildEnd === "function"
    ? plugin.buildEnd
    : plugin.buildEnd.handler
await buildEnd.call({})

let staleRejected = false
try {
  createConsumerDashboardPlugin({
    componentOverrides: [
      {
        override: "src/admin/components/orders/order-list.tsx",
        target: "src/routes/orders/order-list/missing.tsx",
      },
    ],
  })
} catch (error) {
  staleRejected = error?.reasonCode === "target.missing"
}
if (!staleRejected) throw new Error("stale target did not fail closed")

process.stdout.write(`${JSON.stringify(plugin.getOverrideSummary())}\n`)

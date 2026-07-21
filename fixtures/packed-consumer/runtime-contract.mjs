import { createRequire } from "node:module"
import { LayoutComposer } from "@mantajs/medusa-dashboard/components"
import { customDashboardPlugin } from "@mantajs/medusa-dashboard/vite-plugin"
import packageJson from "@mantajs/medusa-dashboard/package.json" with {
  type: "json",
}

if (packageJson.name !== "@mantajs/medusa-dashboard") {
  throw new Error(`canonical package identity mismatch: ${packageJson.name}`)
}
if (typeof LayoutComposer !== "function") {
  throw new Error("ESM components missing")
}
if (typeof customDashboardPlugin !== "function") {
  throw new Error("ESM plugin missing")
}

for (const packageName of [
  "@mantajs/medusa-dashboard",
  "@medusajs/dashboard",
]) {
  for (const subpath of ["", "/css", "/components", "/hooks", "/vite-plugin"]) {
    import.meta.resolve(`${packageName}${subpath}`)
  }
}

const require = createRequire(import.meta.url)
const components = require("@mantajs/medusa-dashboard/components")
const hooks = require("@mantajs/medusa-dashboard/hooks")
const vitePlugin = require("@mantajs/medusa-dashboard/vite-plugin")
if (typeof components.LayoutComposer !== "function") {
  throw new Error("CJS components missing")
}
if (typeof hooks !== "object") throw new Error("CJS hooks missing")
if (typeof vitePlugin.customDashboardPlugin !== "function") {
  throw new Error("CJS plugin missing")
}
require.resolve("@mantajs/medusa-dashboard")
require.resolve("@mantajs/medusa-dashboard/css")
require.resolve("@medusajs/dashboard")
require.resolve("@medusajs/dashboard/css")

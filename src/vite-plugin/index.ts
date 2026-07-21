import { Plugin } from "vite"
import path from "path"
import fs from "fs"
import {
  DASHBOARD_MODULE_EXTENSIONS,
} from "./component-path-matching"
import { createComponentOverridePolicy } from "./override-policy"
import type { CustomDashboardPluginOptions } from "./types"

const MENU_VIRTUAL_ID = "virtual:dashboard/menu-config"
const MENU_RESOLVED_ID = "\0" + MENU_VIRTUAL_ID

function findDashboardSrc(): string | null {
  const cwd = process.cwd()
  const candidates = [
    path.join(cwd, "node_modules", "@medusajs", "dashboard", "src"),
    path.join(cwd, "node_modules", "@mantajs", "dashboard", "src"),
    path.join(cwd, ".yalc", "@mantajs", "dashboard", "src"),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir
  }
  return null
}

/**
 * Vite plugin for @mantajs/dashboard — explicit unbundled overrides.
 *
 * Dashboard excluded from pre-bundling → components served on-demand.
 * Overrides resolve directly to the override file (no virtual proxy).
 * Vite handles modifications to declared override modules through native HMR.
 */
export function customDashboardPlugin(
  options: CustomDashboardPluginOptions = {}
): Plugin {
  const projectRoot = process.cwd()
  const dashboardSrc = findDashboardSrc()
  if ((options.componentOverrides?.length ?? 0) > 0 && !dashboardSrc) {
    throw new Error(
      "[custom-dashboard] Cannot validate component overrides: dashboard src was not found"
    )
  }
  const overridePolicy = createComponentOverridePolicy(
    options.componentOverrides,
    {
      dashboardSrc: dashboardSrc ?? projectRoot,
      projectRoot,
    }
  )

  return {
    name: "custom-dashboard",
    enforce: "pre",

    config(config) {
      config.optimizeDeps = config.optimizeDeps || {}
      config.optimizeDeps.exclude = config.optimizeDeps.exclude || []
      config.optimizeDeps.exclude.push(MENU_VIRTUAL_ID)

      // Exclude dashboard from pre-bundling → on-demand serving.
      config.optimizeDeps.exclude.push("@medusajs/dashboard")
      config.optimizeDeps.exclude.push("@mantajs/dashboard")

      // Medusa puts dashboard in include. include beats exclude in Vite.
      if (config.optimizeDeps.include) {
        config.optimizeDeps.include = config.optimizeDeps.include.filter(
          (dep) =>
            dep !== "@medusajs/dashboard" && dep !== "@mantajs/dashboard"
        )
      }

      // Scan dashboard source so Vite discovers its CJS deps.
      if (dashboardSrc) {
        const entryFile = path.join(dashboardSrc, "app.tsx")
        if (fs.existsSync(entryFile)) {
          const existing = config.optimizeDeps.entries
          if (Array.isArray(existing)) {
            existing.push(entryFile)
          } else if (typeof existing === "string") {
            config.optimizeDeps.entries = [existing, entryFile]
          } else {
            config.optimizeDeps.entries = [entryFile]
          }
        }
      }
    },

    async resolveId(source, importer) {
      if (source === MENU_VIRTUAL_ID) return MENU_RESOLVED_ID

      // Resolve only exact, explicitly configured target modules.
      if (importer) {
        const normImporter = importer.replace(/\\/g, "/")
        if (normImporter.includes("/dashboard/src/")) {
          const resolvedOriginal = await this.resolve(source, importer, {
            skipSelf: true,
          })
          if (resolvedOriginal) {
            const overridePath = overridePolicy.getOverrideForTarget(
              resolvedOriginal.id
            )
            if (overridePath) return overridePath
          }
        }
      }

      // Entry redirect: dist/app.mjs → src/app.tsx
      if (source.includes("dashboard")) {
        const resolved = await this.resolve(source, importer, { skipSelf: true })
        if (resolved) {
          const norm = resolved.id.replace(/\\/g, "/").replace(/\?.*$/, "")
          if (norm.includes("/dashboard/dist/app.")) {
            const srcEntry = norm.replace(/\/dist\/app\.(mjs|js)$/, "/src/app.tsx")
            if (fs.existsSync(srcEntry)) {
              return srcEntry
            }
          }
        }
      }

      return null
    },

    load(id) {
      if (id === MENU_RESOLVED_ID) {
        const basePath = path.resolve(process.cwd(), "src/admin/menu.config")
        for (const ext of DASHBOARD_MODULE_EXTENSIONS) {
          const fullPath = (basePath + ext).replace(/\\/g, "/")
          if (fs.existsSync(fullPath)) {
            return `export { default } from "${fullPath}"`
          }
        }
        return "export default null"
      }
    },
  }
}

export const menuConfigPlugin = customDashboardPlugin

export type {
  CustomDashboardPluginOptions,
  DashboardComponentOverride,
  MenuConfig,
  MenuItem,
  MenuNestedItem,
} from "./types"

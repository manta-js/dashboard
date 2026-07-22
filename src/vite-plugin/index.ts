import { ViteDevServer } from "vite"
import path from "path"
import fs from "fs"
import { DASHBOARD_MODULE_EXTENSIONS } from "./component-path-matching"
import {
  ComponentOverridePolicyError,
  createComponentOverridePolicy,
} from "./override-policy"
import { OverrideDiagnostics } from "./override-diagnostics"
import type {
  CustomDashboardPluginOptions,
  DashboardOverridePlugin,
} from "./types"

const MENU_VIRTUAL_ID = "virtual:dashboard/menu-config"
const MENU_RESOLVED_ID = "\0" + MENU_VIRTUAL_ID
const PUBLIC_SHELL_IDS = new Set([
  "@mantajs/medusa-dashboard/shell",
  "@medusajs/dashboard/shell",
])

function findDashboardSrc(): string | null {
  const cwd = process.cwd()
  const candidates = [
    path.join(cwd, "node_modules", "@medusajs", "dashboard", "src"),
    path.join(cwd, "node_modules", "@mantajs", "medusa-dashboard", "src"),
    path.join(cwd, "node_modules", "@mantajs", "dashboard", "src"),
    path.join(cwd, ".yalc", "@mantajs", "medusa-dashboard", "src"),
    path.join(cwd, ".yalc", "@mantajs", "dashboard", "src"),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir
  }
  return null
}

/**
 * Vite plugin for @mantajs/medusa-dashboard — explicit unbundled overrides.
 *
 * Dashboard excluded from pre-bundling → components served on-demand.
 * Overrides resolve directly to the override file (no virtual proxy).
 * Vite handles modifications to declared override modules through native HMR.
 */
export function customDashboardPlugin(
  options: CustomDashboardPluginOptions = {}
): DashboardOverridePlugin {
  const projectRoot = process.cwd()
  const dashboardSrc = findDashboardSrc()
  const configuredOverrides = options.componentOverrides ?? []
  const diagnostics = new OverrideDiagnostics(
    configuredOverrides,
    options.onDiagnostic,
    options.onSummary
  )
  let overridePolicy: ReturnType<typeof createComponentOverridePolicy>
  try {
    if (configuredOverrides.length > 0 && !dashboardSrc) {
      throw new ComponentOverridePolicyError(
        0,
        "dashboard.missing",
        configuredOverrides[0].override,
        configuredOverrides[0].target,
        "dashboard src was not found"
      )
    }
    overridePolicy = createComponentOverridePolicy(configuredOverrides, {
      dashboardSrc: dashboardSrc ?? projectRoot,
      projectRoot,
    })
    for (const entry of overridePolicy.entries) diagnostics.accept(entry)
  } catch (error) {
    if (error instanceof ComponentOverridePolicyError) {
      diagnostics.reject(error)
    }
    throw error
  }

  const invalidateEntry = (
    server: ViteDevServer,
    entry: (typeof overridePolicy.entries)[number]
  ) => {
    for (const file of [entry.targetPath, entry.overridePath]) {
      const modules = server.moduleGraph.getModulesByFile(file)
      if (!modules) continue
      for (const module of modules) server.moduleGraph.invalidateModule(module)
    }
  }

  const plugin: DashboardOverridePlugin = {
    getOverrideSummary: () => diagnostics.getSummary(),
    name: "custom-dashboard",
    enforce: "pre",

    buildEnd() {
      diagnostics.finalize()
    },

    configureServer(server) {
      const declaredPaths = overridePolicy.entries.flatMap(
        ({ overridePath, targetPath }) => [overridePath, targetPath]
      )
      if (declaredPaths.length === 0) return

      const presentOverrides = new Set(
        overridePolicy.entries.map(({ overridePath }) => overridePath)
      )
      server.watcher.add(declaredPaths)

      server.watcher.on("change", (file) => {
        const entry =
          overridePolicy.getEntryForOverridePath(file) ??
          overridePolicy.getEntryForTarget(file)
        if (entry) invalidateEntry(server, entry)
      })
      server.watcher.on("unlink", (file) => {
        const overrideEntry = overridePolicy.getEntryForOverridePath(file)
        if (
          overrideEntry &&
          presentOverrides.delete(overrideEntry.overridePath)
        ) {
          diagnostics.lifecycle("deleted", overrideEntry)
          invalidateEntry(server, overrideEntry)
          return
        }
        const targetEntry = overridePolicy.getEntryForTarget(file)
        if (targetEntry) invalidateEntry(server, targetEntry)
      })
      server.watcher.on("add", (file) => {
        const overrideEntry = overridePolicy.getEntryForOverridePath(file)
        if (
          overrideEntry &&
          !presentOverrides.has(overrideEntry.overridePath)
        ) {
          presentOverrides.add(overrideEntry.overridePath)
          diagnostics.lifecycle("restored", overrideEntry)
          invalidateEntry(server, overrideEntry)
          return
        }
        const targetEntry = overridePolicy.getEntryForTarget(file)
        if (targetEntry) invalidateEntry(server, targetEntry)
      })
    },

    config(config) {
      config.optimizeDeps = config.optimizeDeps || {}
      config.optimizeDeps.exclude = config.optimizeDeps.exclude || []
      config.optimizeDeps.exclude.push(MENU_VIRTUAL_ID)

      // Exclude dashboard from pre-bundling → on-demand serving.
      config.optimizeDeps.exclude.push("@medusajs/dashboard")
      config.optimizeDeps.exclude.push("@mantajs/medusa-dashboard")
      config.optimizeDeps.exclude.push("@mantajs/dashboard")

      // Medusa puts dashboard in include. include beats exclude in Vite.
      if (config.optimizeDeps.include) {
        config.optimizeDeps.include = config.optimizeDeps.include.filter(
          (dep) =>
            dep !== "@medusajs/dashboard" &&
            dep !== "@mantajs/medusa-dashboard" &&
            dep !== "@mantajs/dashboard"
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

      if (dashboardSrc && PUBLIC_SHELL_IDS.has(source)) {
        const shellEntry = path.join(dashboardSrc, "exports/shell.ts")
        if (!fs.existsSync(shellEntry)) {
          throw new Error(
            `[custom-dashboard] The public Shell source entry is missing: ${shellEntry}`
          )
        }
        return shellEntry
      }

      // Resolve only exact, explicitly configured target modules.
      if (importer) {
        const normImporter = importer.replace(/\\/g, "/")
        if (normImporter.includes("/dashboard/src/")) {
          const resolvedOriginal = await this.resolve(source, importer, {
            skipSelf: true,
          })
          if (resolvedOriginal) {
            const entry = overridePolicy.getEntryForTarget(resolvedOriginal.id)
            if (entry) {
              if (!fs.existsSync(entry.overridePath)) {
                throw new Error(
                  `[custom-dashboard] Declared override ${entry.override} for ${entry.target} is missing; restore the file or remove the policy entry`
                )
              }
              diagnostics.apply(entry)
              return entry.overridePath
            }
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

  return plugin
}

export const menuConfigPlugin = customDashboardPlugin

export type {
  CustomDashboardPluginOptions,
  DashboardComponentOverride,
  DashboardOverrideDecision,
  DashboardOverrideDiagnostic,
  DashboardOverrideDiagnosticKind,
  DashboardOverridePlugin,
  DashboardOverrideSummary,
  MenuConfig,
  MenuItem,
  MenuNestedItem,
} from "./types"

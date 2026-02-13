import { Plugin, ViteDevServer } from "vite"
import path from "path"
import fs from "fs"

const MENU_VIRTUAL_ID = "virtual:dashboard/menu-config"
const MENU_RESOLVED_ID = "\0" + MENU_VIRTUAL_ID

const COMPONENT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mts", ".mjs"]
const COMPONENT_EXT_SET = new Set(COMPONENT_EXTENSIONS)

function collectComponentFiles(dir: string, depth = 0): string[] {
  if (depth > 20) return []
  const results: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue
    const fullPath = path.resolve(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectComponentFiles(fullPath, depth + 1))
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name)
      if (COMPONENT_EXT_SET.has(ext)) {
        results.push(fullPath)
      }
    }
  }
  return results
}

function getComponentName(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/")
  const parts = normalized.split("/").filter(Boolean)
  if (parts.length === 0) return null
  const fileName = parts[parts.length - 1]
  const baseName = fileName.replace(/\.(tsx?|jsx?|mts|mjs)$/, "")
  if (!baseName) return null
  if (baseName === "index") {
    return parts.length >= 2 ? parts[parts.length - 2] || null : null
  }
  if (parts.length >= 2 && baseName === parts[parts.length - 2]) {
    return baseName
  }
  return baseName
}

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
 * Vite plugin for @mantajs/dashboard — v2 "unbundled overrides".
 *
 * Dashboard excluded from pre-bundling → components served on-demand.
 * Overrides resolve directly to the override file (no virtual proxy).
 * All scenarios (create/delete/modify) use native HMR — zero full reloads.
 */
export function customDashboardPlugin(): Plugin {
  const componentsDir = path.resolve(process.cwd(), "src/admin/components")
  const overridesByName = new Map<string, string>()

  // Map component name → original dashboard file path (for module graph lookup)
  const dashboardComponentFiles = new Map<string, string>()
  const dashboardSrc = findDashboardSrc()
  if (dashboardSrc) {
    for (const f of collectComponentFiles(dashboardSrc)) {
      const cName = getComponentName(f)
      if (cName) dashboardComponentFiles.set(cName, f)
    }
  }

  if (fs.existsSync(componentsDir)) {
    for (const fullPath of collectComponentFiles(componentsDir).sort()) {
      const name = path.basename(fullPath).replace(/\.(tsx?|jsx?|mts|mjs)$/, "")
      if (name && name !== "index") {
        overridesByName.set(name, fullPath)
      }
    }
  }

  let currentServer: ViteDevServer | null = null
  let watcherCreated = false

  if (process.env.NODE_ENV === "development") {
    if (overridesByName.size > 0) {
      console.log("[custom-dashboard] overrides:", [...overridesByName.keys()])
    }
    if (dashboardComponentFiles.size > 0) {
      console.log(
        `[custom-dashboard] Scanned ${dashboardComponentFiles.size} dashboard components`
      )
    }
  }

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

      // Resolve directly to override file (no virtual proxy → native HMR works)
      if (importer) {
        const normImporter = importer.replace(/\\/g, "/")
        if (normImporter.includes("/dashboard/src/")) {
          const basename = path.basename(source).replace(/\.(tsx?|jsx?|mts|mjs)$/, "")
          if (basename && basename !== "index" && overridesByName.has(basename)) {
            return overridesByName.get(basename)
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
        for (const ext of COMPONENT_EXTENSIONS) {
          const fullPath = (basePath + ext).replace(/\\/g, "/")
          if (fs.existsSync(fullPath)) {
            return `export { default } from "${fullPath}"`
          }
        }
        return "export default null"
      }
    },

    configureServer(server: ViteDevServer) {
      currentServer = server

      if (!fs.existsSync(componentsDir)) return

      if (!watcherCreated) {
        watcherCreated = true
        let debounceTimer: ReturnType<typeof setTimeout> | null = null

        fs.watch(componentsDir, { recursive: true }, (_event, filename) => {
          if (!filename) return
          const ext = path.extname(filename)
          if (!COMPONENT_EXT_SET.has(ext)) return

          const name = path.basename(filename).replace(/\.(tsx?|jsx?|mts|mjs)$/, "")
          if (!name || name === "index") return
          if (!dashboardComponentFiles.has(name)) return

          const fullPath = path.resolve(componentsDir, filename)
          const fileExists = fs.existsSync(fullPath)
          const wasKnown = overridesByName.has(name)

          // Modification — native HMR handles it
          if (fileExists && wasKnown) return

          // Create or delete — HMR via module graph invalidation (no restart)
          if (debounceTimer) clearTimeout(debounceTimer)
          debounceTimer = setTimeout(() => {
            // Rescan all overrides (handles rapid multi-file changes)
            const oldOverrides = new Map(overridesByName)
            overridesByName.clear()
            for (const fp of collectComponentFiles(componentsDir).sort()) {
              const n = path.basename(fp).replace(/\.(tsx?|jsx?|mts|mjs)$/, "")
              if (n && n !== "index") {
                overridesByName.set(n, fp)
              }
            }

            if (!currentServer) return
            const { moduleGraph } = currentServer

            // Diff old vs new to find what actually changed
            const allNames = new Set([...oldOverrides.keys(), ...overridesByName.keys()])
            for (const n of allNames) {
              const wasOverride = oldOverrides.has(n)
              const isOverride = overridesByName.has(n)
              if (wasOverride === isOverride) continue

              const action = isOverride ? "created" : "deleted"
              console.log(`[custom-dashboard] Override "${n}" ${action} → HMR update`)

              // Find the module that was serving this component
              // Normalize paths (forward slashes) for cross-platform compatibility
              let targetMod: ReturnType<typeof moduleGraph.getModulesByFile> = undefined
              if (isOverride) {
                // CREATE: find the original dashboard module in the graph
                const originalPath = dashboardComponentFiles.get(n)
                if (originalPath) {
                  targetMod = moduleGraph.getModulesByFile(originalPath.replace(/\\/g, "/"))
                }
              } else {
                // DELETE: find the now-removed override module in the graph
                const oldPath = oldOverrides.get(n)!
                targetMod = moduleGraph.getModulesByFile(oldPath.replace(/\\/g, "/"))
              }

              const targetModule = targetMod ? [...targetMod][0] : undefined
              if (targetModule && targetModule.importers.size > 0) {
                // Invalidate target so it's not served stale
                moduleGraph.invalidateModule(targetModule)

                // Emit change on importers — Vite's native HMR pipeline
                // handles boundary detection and update propagation
                for (const importer of targetModule.importers) {
                  if (importer.file) {
                    console.log(`[custom-dashboard] HMR → ${path.basename(importer.file)}`)
                    currentServer!.watcher.emit("change", importer.file)
                  }
                }
              } else {
                console.log(`[custom-dashboard] Override map updated (module not in graph)`)
              }
            }
          }, 300)
        })
      }
    },
  }
}

export const menuConfigPlugin = customDashboardPlugin

export type { MenuConfig, MenuItem, MenuNestedItem } from "./types"

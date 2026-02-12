import { Plugin, ViteDevServer } from "vite"
import path from "path"
import fs from "fs"

const MENU_VIRTUAL_ID = "virtual:dashboard/menu-config"
const MENU_RESOLVED_ID = "\0" + MENU_VIRTUAL_ID

const COMPONENT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mts", ".mjs"]
const COMPONENT_EXT_SET = new Set(COMPONENT_EXTENSIONS)

const VALID_LOADERS: Record<string, string> = {
  tsx: "tsx",
  ts: "ts",
  jsx: "jsx",
  js: "js",
  mts: "ts",
  mjs: "js",
}

/**
 * Recursively collect all component files from a directory tree.
 * Includes a depth guard to prevent symlink loops and skips hidden
 * entries / node_modules.
 */
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

/**
 * Extract a component name from a resolved file path.
 */
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

/**
 * Find the dashboard source directory by checking known install paths.
 * Works with yarn resolutions, direct installs, and yalc links.
 */
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
 * Unified Vite plugin for @mantajs/dashboard.
 *
 * Handles:
 * 1. Menu config virtual module (virtual:dashboard/menu-config)
 * 2. Component overrides — any file in src/admin/components/ overrides the
 *    dashboard component with the same name.
 */
export function customDashboardPlugin(): Plugin {
  const componentsDir = path.resolve(process.cwd(), "src/admin/components")
  const overridesByName = new Map<string, string>()

  // Track which overrides were actually matched during esbuild pre-bundling.
  // Only these are real overrides — the rest are regular project components
  // that happen to live in the same directory.
  const appliedOverrides = new Set<string>()

  // Scan dashboard source at startup to know all possible override targets.
  // This lets the file watcher decide if a newly created file could be an
  // override, without maintaining any hardcoded list.
  const knownDashboardComponents = new Set<string>()
  const dashboardSrc = findDashboardSrc()
  if (dashboardSrc) {
    for (const f of collectComponentFiles(dashboardSrc)) {
      const cName = getComponentName(f)
      if (cName) knownDashboardComponents.add(cName)
    }
  }

  if (fs.existsSync(componentsDir)) {
    const collectedFiles = collectComponentFiles(componentsDir).sort()
    for (const fullPath of collectedFiles) {
      const fileName = path.basename(fullPath)
      const name = fileName.replace(/\.(tsx?|jsx?|mts|mjs)$/, "")
      if (name && name !== "index") {
        if (overridesByName.has(name) && process.env.NODE_ENV === "development") {
          console.warn(
            `[custom-dashboard] Duplicate override "${name}": ${overridesByName.get(name)} will be replaced by ${fullPath}`
          )
        }
        overridesByName.set(name, fullPath)
      }
    }
  }

  const hasOverrides = overridesByName.size > 0

  if (process.env.NODE_ENV === "development") {
    if (hasOverrides) {
      console.log("[custom-dashboard] overrides:", [...overridesByName.keys()])
    }
    if (knownDashboardComponents.size > 0) {
      console.log(
        `[custom-dashboard] Scanned ${knownDashboardComponents.size} dashboard components for override matching`
      )
    }
  }

  return {
    name: "custom-dashboard",
    enforce: "pre",

    config(config) {
      // Always exclude the menu virtual module
      config.optimizeDeps = config.optimizeDeps || {}
      config.optimizeDeps.exclude = config.optimizeDeps.exclude || []
      config.optimizeDeps.exclude.push(MENU_VIRTUAL_ID)

      // Always set up the esbuild override plugin — even if there are no
      // overrides yet, the configureServer watcher may add some at runtime
      // and trigger a restart.
      config.optimizeDeps.esbuildOptions = config.optimizeDeps.esbuildOptions || {}
      config.optimizeDeps.esbuildOptions.plugins =
        config.optimizeDeps.esbuildOptions.plugins || []

      const overrides = overridesByName
      config.optimizeDeps.esbuildOptions.plugins.push({
        name: "dashboard-component-overrides",
        setup(build) {
          // 1. Redirect the dist entry to source so esbuild processes
          //    individual TSX files instead of one big pre-built bundle.
          build.onLoad({ filter: /app\.(mjs|js)$/ }, (args) => {
            // Only activate when there are overrides
            if (overrides.size === 0) return undefined

            const normalized = args.path.replace(/\\/g, "/")
            if (!normalized.includes("/dashboard/dist/")) return undefined

            const srcEntry = normalized
              .replace(/\/dist\/app\.(mjs|js)$/, "/src/app.tsx")

            let contents: string
            try {
              contents = fs.readFileSync(srcEntry, "utf-8")
            } catch {
              return undefined
            }

            if (process.env.NODE_ENV === "development") {
              console.log(
                `[custom-dashboard] Redirecting entry: ${args.path} → ${srcEntry}`
              )
            }
            return {
              contents,
              loader: "tsx",
              resolveDir: path.dirname(srcEntry),
            }
          })

          // 2. Intercept individual source files to swap with overrides.
          build.onLoad({ filter: /\.(tsx?|jsx?)$/ }, (args) => {
            if (overrides.size === 0) return undefined

            const normalized = args.path.replace(/\\/g, "/")
            if (!normalized.includes("/dashboard/src/")) return undefined

            // Skip index/barrel files to preserve re-exports
            const fileName = path.basename(args.path)
            if (fileName.startsWith("index.")) return undefined

            const componentName = getComponentName(args.path)
            if (componentName && overrides.has(componentName)) {
              const overridePath = overrides.get(componentName)!
              const ext = path.extname(overridePath).slice(1)
              const loader = VALID_LOADERS[ext] || "tsx"

              let contents: string
              try {
                contents = fs.readFileSync(overridePath, "utf-8")
              } catch {
                return undefined
              }

              // Track this as a real applied override
              appliedOverrides.add(componentName)

              if (process.env.NODE_ENV === "development") {
                console.log(
                  `[custom-dashboard] Override: ${componentName} → ${overridePath}`
                )
              }
              return {
                contents,
                loader: loader as any,
                resolveDir: path.dirname(overridePath),
              }
            }
            return undefined
          })
        },
      })

      // Force re-optimisation so overrides are always applied
      config.optimizeDeps.force = true
    },

    configureServer(server: ViteDevServer) {
      if (!fs.existsSync(componentsDir)) return

      let debounceTimer: ReturnType<typeof setTimeout> | null = null

      /** Extract override-candidate name from a watched file, or null */
      const extractName = (file: string): string | null => {
        const normalized = file.replace(/\\/g, "/")
        if (!normalized.startsWith(componentsDir.replace(/\\/g, "/"))) return null
        const ext = path.extname(file)
        if (!COMPONENT_EXT_SET.has(ext)) return null
        const fileName = path.basename(file)
        const name = fileName.replace(/\.(tsx?|jsx?|mts|mjs)$/, "")
        if (!name || name === "index") return null
        return name
      }

      /** Re-collect overrides from disk and restart the dev server */
      const triggerRestart = (name: string, reason: string) => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          const newOverrides = new Map<string, string>()
          const collectedFiles = collectComponentFiles(componentsDir).sort()
          for (const fullPath of collectedFiles) {
            const fn = path.basename(fullPath)
            const n = fn.replace(/\.(tsx?|jsx?|mts|mjs)$/, "")
            if (n && n !== "index") {
              newOverrides.set(n, fullPath)
            }
          }

          overridesByName.clear()
          for (const [k, v] of newOverrides) overridesByName.set(k, v)

          console.log(
            `[custom-dashboard] Override "${name}" ${reason} → restarting Vite...`
          )
          console.log(
            `[custom-dashboard] overrides:`,
            [...overridesByName.keys()]
          )

          server.restart()
        }, 300)
      }

      server.watcher.add(componentsDir)

      // ADD: new file — restart only if its name matches a known dashboard
      // component (i.e. it could be a new override)
      server.watcher.on("add", (file: string) => {
        const name = extractName(file)
        if (name && knownDashboardComponents.has(name)) {
          triggerRestart(name, "created")
        }
      })

      // CHANGE: file modified — restart only if it's an active override
      // (was matched by esbuild during pre-bundling)
      server.watcher.on("change", (file: string) => {
        const name = extractName(file)
        if (name && appliedOverrides.has(name)) {
          triggerRestart(name, "modified")
        }
      })

      // UNLINK: file deleted — restart only if it was an active override
      server.watcher.on("unlink", (file: string) => {
        const name = extractName(file)
        if (name && appliedOverrides.has(name)) {
          appliedOverrides.delete(name)
          triggerRestart(name, "deleted")
        }
      })
    },

    resolveId(source) {
      if (source === MENU_VIRTUAL_ID) return MENU_RESOLVED_ID
      return null
    },

    load(id) {
      if (id !== MENU_RESOLVED_ID) return
      const basePath = path.resolve(process.cwd(), "src/admin/menu.config")
      for (const ext of COMPONENT_EXTENSIONS) {
        const fullPath = (basePath + ext).replace(/\\/g, "/")
        if (fs.existsSync(fullPath)) {
          return `export { default } from "${fullPath}"`
        }
      }
      return "export default null"
    },
  }
}

// Keep backward-compatible alias
export const menuConfigPlugin = customDashboardPlugin

export type { MenuConfig, MenuItem, MenuNestedItem } from "./types"

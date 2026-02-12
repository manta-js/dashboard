import { Plugin } from "vite"
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

  if (hasOverrides && process.env.NODE_ENV === "development") {
    console.log("[custom-dashboard] overrides:", [...overridesByName.keys()])
  }

  return {
    name: "custom-dashboard",
    enforce: "pre",

    config(config) {
      // Always exclude the menu virtual module
      config.optimizeDeps = config.optimizeDeps || {}
      config.optimizeDeps.exclude = config.optimizeDeps.exclude || []
      config.optimizeDeps.exclude.push(MENU_VIRTUAL_ID)

      if (hasOverrides) {
        // Strategy: the package.json points to dist/app.mjs (so the browser
        // gets a working pre-bundled chunk — no blank page).  But during
        // esbuild pre-bundling we redirect the dist entry to the source TSX
        // via onLoad, so esbuild follows individual imports and we can swap
        // component files with the user's overrides.
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
      }
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

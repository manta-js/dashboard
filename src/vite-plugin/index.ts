import { Plugin, ViteDevServer } from "vite"
import path from "path"
import fs from "fs"

const MENU_VIRTUAL_ID = "virtual:dashboard/menu-config"
const MENU_RESOLVED_ID = "\0" + MENU_VIRTUAL_ID

// Unique prefix for override imports — esbuild marks these as external,
// then Vite's resolveId resolves them to the actual file paths.
const OVERRIDE_PREFIX = "__mantajs_override__:"

const COMPONENT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mts", ".mjs"]
const COMPONENT_EXT_SET = new Set(COMPONENT_EXTENSIONS)

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
 * 2. Component overrides — any file in src/admin/components/ whose name
 *    matches a dashboard component replaces it at build time.
 *
 * HMR Architecture:
 * - Override files are NOT inlined into the esbuild pre-bundled chunk.
 *   Instead, the chunk contains `export * from "/@fs/path/to/override.tsx"`,
 *   keeping the override as a **separate Vite module**.
 * - Because the override is a separate module exporting React components,
 *   @vitejs/plugin-react adds React Fast Refresh boundaries
 *   (import.meta.hot.accept). This makes the module self-accepting for HMR.
 * - On MODIFICATION: Vite detects the file change, transforms it, and sends
 *   an HMR update. React Fast Refresh swaps the component — no page reload.
 * - On CREATION or DELETION: The esbuild pre-bundle must be rebuilt (the
 *   chunk structure changes). We restart Vite + send a full-reload to the
 *   browser so it picks up the new chunks automatically.
 * - The fs.watch is independent from Vite's internal watcher, so it
 *   survives server.restart() calls without losing events.
 */
export function customDashboardPlugin(): Plugin {
  const componentsDir = path.resolve(process.cwd(), "src/admin/components")
  const overridesByName = new Map<string, string>()

  // Scan dashboard source once at startup — used to decide if a changed
  // file is a potential override (~966 names, ~30 KB).
  const dashboardComponents = new Set<string>()
  const dashboardSrc = findDashboardSrc()
  if (dashboardSrc) {
    for (const f of collectComponentFiles(dashboardSrc)) {
      const cName = getComponentName(f)
      if (cName) dashboardComponents.add(cName)
    }
  }

  // Collect initial overrides from disk
  if (fs.existsSync(componentsDir)) {
    for (const fullPath of collectComponentFiles(componentsDir).sort()) {
      const name = path.basename(fullPath).replace(/\.(tsx?|jsx?|mts|mjs)$/, "")
      if (name && name !== "index") {
        overridesByName.set(name, fullPath)
      }
    }
  }

  const hasOverrides = overridesByName.size > 0

  // Mutable ref to the latest Vite server — updated on each configureServer
  let currentServer: ViteDevServer | null = null
  let watcherCreated = false

  // Track known override file paths to distinguish modify vs create/delete
  const knownOverrideFiles = new Set<string>(overridesByName.values())

  if (process.env.NODE_ENV === "development") {
    if (hasOverrides) {
      console.log("[custom-dashboard] overrides:", [...overridesByName.keys()])
    }
    if (dashboardComponents.size > 0) {
      console.log(
        `[custom-dashboard] Scanned ${dashboardComponents.size} dashboard components`
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

      config.optimizeDeps.esbuildOptions = config.optimizeDeps.esbuildOptions || {}
      config.optimizeDeps.esbuildOptions.plugins =
        config.optimizeDeps.esbuildOptions.plugins || []

      const overrides = overridesByName
      config.optimizeDeps.esbuildOptions.plugins.push({
        name: "dashboard-component-overrides",
        setup(build) {
          // Mark override imports as external — this keeps override files as
          // separate ES modules that Vite processes individually, enabling
          // React Fast Refresh HMR instead of requiring a full page reload.
          build.onResolve({ filter: /^__mantajs_override__:/ }, (args) => ({
            path: args.path,
            external: true,
          }))

          // Redirect dist entry → source so esbuild processes individual files
          build.onLoad({ filter: /app\.(mjs|js)$/ }, (args) => {
            if (overrides.size === 0) return undefined
            const normalized = args.path.replace(/\\/g, "/")
            if (!normalized.includes("/dashboard/dist/")) return undefined

            const srcEntry = normalized.replace(/\/dist\/app\.(mjs|js)$/, "/src/app.tsx")
            let contents: string
            try {
              contents = fs.readFileSync(srcEntry, "utf-8")
            } catch {
              return undefined
            }

            if (process.env.NODE_ENV === "development") {
              console.log(`[custom-dashboard] Redirecting entry → ${srcEntry}`)
            }
            return { contents, loader: "tsx", resolveDir: path.dirname(srcEntry) }
          })

          // For overridden components, emit a re-export from /@fs/ instead of
          // inlining the file contents. The override becomes a separate Vite
          // module with full HMR support via React Fast Refresh.
          build.onLoad({ filter: /\.(tsx?|jsx?)$/ }, (args) => {
            if (overrides.size === 0) return undefined
            const normalized = args.path.replace(/\\/g, "/")
            if (!normalized.includes("/dashboard/src/")) return undefined

            const fileName = path.basename(args.path)
            if (fileName.startsWith("index.")) return undefined

            const componentName = getComponentName(args.path)
            if (componentName && overrides.has(componentName)) {
              const overridePath = overrides.get(componentName)!
              const normalizedPath = overridePath.replace(/\\/g, "/")

              if (process.env.NODE_ENV === "development") {
                console.log(`[custom-dashboard] Override: ${componentName} → ${overridePath}`)
              }
              return {
                contents: `export * from "${OVERRIDE_PREFIX}${normalizedPath}"`,
                loader: "tsx",
                resolveDir: path.dirname(args.path),
              }
            }
            return undefined
          })
        },
      })

      // Include override state in esbuild define — this changes Vite's dep
      // optimization hash (?v=xxx), forcing the browser to fetch fresh chunks
      // whenever overrides are added or removed (prevents stale cache 404s).
      config.optimizeDeps.esbuildOptions.define = {
        ...config.optimizeDeps.esbuildOptions.define,
        '__MANTAJS_OVERRIDES__': JSON.stringify(
          [...overrides.keys()].sort().join(',')
        ),
      }
      config.optimizeDeps.force = true
    },

    configureServer(server: ViteDevServer) {
      // Always update server ref (called again after each server.restart())
      currentServer = server

      if (!fs.existsSync(componentsDir)) return

      // Create ONE independent watcher that survives server.restart().
      // Uses Node's fs.watch (FSEvents on macOS) — lightweight, no polling.
      if (!watcherCreated) {
        watcherCreated = true
        let debounceTimer: ReturnType<typeof setTimeout> | null = null

        fs.watch(componentsDir, { recursive: true }, (_event, filename) => {
          if (!filename) return
          const ext = path.extname(filename)
          if (!COMPONENT_EXT_SET.has(ext)) return

          const name = path.basename(filename).replace(/\.(tsx?|jsx?|mts|mjs)$/, "")
          if (!name || name === "index") return

          // Only act if this file name matches a dashboard component
          if (!dashboardComponents.has(name)) return

          const fullPath = path.resolve(componentsDir, filename)
          const fileExists = fs.existsSync(fullPath)
          const wasKnown = knownOverrideFiles.has(fullPath)

          if (fileExists && wasKnown) {
            // MODIFICATION — send HMR update ourselves. After server.restart(),
            // Vite's internal chokidar may not fire for override files, so we
            // handle it entirely from our independent fs.watch.
            const mods = currentServer?.moduleGraph.getModulesByFile(fullPath)
            if (mods && mods.size > 0) {
              for (const mod of mods) {
                currentServer!.moduleGraph.invalidateModule(mod)
              }
              currentServer!.ws.send({
                type: "update",
                updates: [...mods].map((mod) => ({
                  type: "js-update" as const,
                  path: mod.url,
                  acceptedPath: mod.url,
                  timestamp: Date.now(),
                  explicitImportRequired: false,
                })),
              })
              console.log(`[custom-dashboard] Override "${name}" modified → HMR`)
            } else {
              console.log(`[custom-dashboard] Override "${name}" not in graph → force-reload`)
              currentServer?.ws.send({ type: "custom", event: "mantajs:force-reload" })
            }
            return
          }

          // CREATION or DELETION — the esbuild pre-bundle must be rebuilt
          // because the chunk structure changes (new external ref or removed).
          if (debounceTimer) clearTimeout(debounceTimer)
          debounceTimer = setTimeout(async () => {
            // Re-scan overrides from disk
            overridesByName.clear()
            knownOverrideFiles.clear()
            for (const fp of collectComponentFiles(componentsDir).sort()) {
              const n = path.basename(fp).replace(/\.(tsx?|jsx?|mts|mjs)$/, "")
              if (n && n !== "index") {
                overridesByName.set(n, fp)
                knownOverrideFiles.add(fp)
              }
            }

            const action = fileExists ? "created" : "deleted"
            console.log(`[custom-dashboard] Override "${name}" ${action} → restarting...`)
            console.log(`[custom-dashboard] overrides:`, [...overridesByName.keys()])

            // Vite preserves the WebSocket connection across restart() — the
            // browser never disconnects. Await restart, then tell the client
            // to do a cache-busting reload (location.reload() reuses cached
            // modules; our custom event navigates to a timestamped URL instead).
            try {
              if (!currentServer) {
                console.warn(`[custom-dashboard] No server available for restart`)
                return
              }
              await currentServer.restart()
              currentServer.ws.send({
                type: "custom",
                event: "mantajs:force-reload",
              })
              console.log(`[custom-dashboard] Force-reload sent to browser`)
            } catch (e) {
              console.error(`[custom-dashboard] Restart failed:`, e)
            }
          }, 300)
        })
      }
    },

    handleHotUpdate({ file }) {
      // Suppress Vite's default HMR for override files — our fs.watch
      // handles modifications (HMR) and deletions (restart) instead.
      if (knownOverrideFiles.has(file)) {
        return []
      }
    },

    transformIndexHtml(html) {
      // Inject a client-side script that listens for our force-reload event.
      // Unlike location.reload(), this navigates to a cache-busting URL so
      // the browser re-fetches all modules (including pre-bundled chunks).
      return html.replace(
        "</head>",
        `<script type="module">
if (import.meta.hot) {
  import.meta.hot.on("mantajs:force-reload", () => {
    const url = new URL(location.href);
    url.searchParams.set("_r", Date.now().toString());
    location.replace(url.href);
  });
}
</script>
</head>`
      )
    },

    resolveId(source) {
      if (source === MENU_VIRTUAL_ID) return MENU_RESOLVED_ID
      // Resolve override imports to the actual file path — Vite then serves
      // the file through its transform pipeline (including React Fast Refresh).
      if (source.startsWith(OVERRIDE_PREFIX)) {
        return source.slice(OVERRIDE_PREFIX.length)
      }
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

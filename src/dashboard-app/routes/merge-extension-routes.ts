import { RouteObject } from "react-router-dom"

/**
 * Merges extension routes into static routes. When an extension route has the
 * same path as a static route, the extension's component/lazy wins while
 * static children that are not redefined by the extension are preserved.
 */
export function mergeExtensionRoutes(
  staticRoutes: RouteObject[],
  extensionRoutes: RouteObject[]
): RouteObject[] {
  if (!extensionRoutes.length) return staticRoutes

  const result = [...staticRoutes]

  for (const ext of extensionRoutes) {
    const extPath = (ext.path ?? "").replace(/^\/+/, "")
    const idx = result.findIndex(
      (r) => (r.path ?? "").replace(/^\/+/, "") === extPath
    )

    if (idx === -1) {
      result.push(ext)
      continue
    }

    const existing = result[idx]
    const merged = { ...existing }

    // Extension component takes priority
    if (ext.lazy) {
      merged.lazy = ext.lazy
      delete (merged as any).Component
      delete (merged as any).loader
    }

    // Recursively merge children — static children not redefined by the
    // extension are preserved (e.g. /orders/:id stays when only /orders ""
    // is overridden).
    if (ext.children || existing.children) {
      merged.children = mergeExtensionRoutes(
        existing.children || [],
        ext.children || []
      )
    }

    result[idx] = merged
  }

  return result
}

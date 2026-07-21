import { describe, expect, it } from "vitest"
import type { RouteObject } from "react-router-dom"

import { mergeExtensionRoutes } from "../merge-extension-routes"

describe("mergeExtensionRoutes", () => {
  it("lets an extension override a page while preserving unmatched core children", () => {
    const coreComponent = () => null
    const extensionComponent = () => null
    const coreRoutes: RouteObject[] = [
      {
        path: "/orders",
        Component: coreComponent,
        children: [
          { path: ":id", Component: coreComponent },
          { path: "create", Component: coreComponent },
        ],
      },
    ]
    const extensions: RouteObject[] = [
      {
        path: "orders",
        Component: extensionComponent,
        children: [{ path: "create", Component: extensionComponent }],
      },
    ]

    const [orders] = mergeExtensionRoutes(coreRoutes, extensions)

    expect(orders.Component).toBe(extensionComponent)
    expect(orders.children).toEqual([
      { path: ":id", Component: coreComponent },
      { path: "create", Component: extensionComponent },
    ])
  })

  it("appends extension routes that do not replace a core route", () => {
    const extension: RouteObject = { path: "/reports", Component: () => null }

    const result = mergeExtensionRoutes(
      [{ path: "/orders", Component: () => null }],
      [extension]
    )

    expect(result).toHaveLength(2)
    expect(result[1]).toBe(extension)
  })

  it("does not mutate either input route array", () => {
    const coreRoutes: RouteObject[] = [
      { path: "/orders", children: [{ path: ":id" }] },
    ]
    const extensions: RouteObject[] = [
      { path: "/orders", children: [{ path: "create" }] },
    ]
    const coreSnapshot = structuredClone(coreRoutes)
    const extensionSnapshot = structuredClone(extensions)

    mergeExtensionRoutes(coreRoutes, extensions)

    expect(coreRoutes).toEqual(coreSnapshot)
    expect(extensions).toEqual(extensionSnapshot)
  })
})

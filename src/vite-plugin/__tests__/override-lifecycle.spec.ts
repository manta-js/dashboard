import { EventEmitter } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { customDashboardPlugin } from "../index"
import type { DashboardOverrideDiagnostic } from "../types"

const roots: string[] = []

const createFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-hmr-"))
  roots.push(root)
  const projectRoot = path.join(root, "consumer")
  const dashboardSrc = path.join(
    projectRoot,
    "node_modules/@medusajs/dashboard/src"
  )
  const override = "src/admin/components/orders/order-summary.tsx"
  const target = "src/routes/orders/order-summary.tsx"
  const overridePath = path.join(projectRoot, override)
  const targetPath = path.join(dashboardSrc, "routes/orders/order-summary.tsx")
  fs.mkdirSync(path.dirname(overridePath), { recursive: true })
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(overridePath, "export default function Override() {}\n")
  fs.writeFileSync(targetPath, "export default function Original() {}\n")
  return { dashboardSrc, override, overridePath, projectRoot, target, targetPath }
}

const configureServer = (
  plugin: ReturnType<typeof customDashboardPlugin>,
  server: object
) => {
  const hook =
    typeof plugin.configureServer === "function"
      ? plugin.configureServer
      : plugin.configureServer!.handler
  hook.call({} as never, server as never)
}

const resolveTarget = async (
  plugin: ReturnType<typeof customDashboardPlugin>,
  targetPath: string,
  importer: string
) => {
  const hook =
    typeof plugin.resolveId === "function"
      ? plugin.resolveId
      : plugin.resolveId!.handler
  return hook.call(
    { resolve: async () => ({ id: targetPath }) } as never,
    "./order-summary",
    importer,
    { attributes: {}, isEntry: false }
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

describe("declared override lifecycle", () => {
  it("watches and invalidates only declared files across change, delete, and restore", async () => {
    const fixture = createFixture()
    vi.spyOn(process, "cwd").mockReturnValue(fixture.projectRoot)
    const events: DashboardOverrideDiagnostic[] = []
    const watcher = new EventEmitter() as EventEmitter & {
      add: ReturnType<typeof vi.fn>
    }
    watcher.add = vi.fn()
    const targetModule = { importers: new Set() }
    const overrideModule = { importers: new Set() }
    const invalidateModule = vi.fn()
    const getModulesByFile = vi.fn((file: string) => {
      if (file === fixture.targetPath) return new Set([targetModule])
      if (file === fixture.overridePath) return new Set([overrideModule])
      return undefined
    })
    const plugin = customDashboardPlugin({
      componentOverrides: [
        { override: fixture.override, target: fixture.target },
      ],
      onDiagnostic: (event) => events.push(event),
    })

    configureServer(plugin, {
      moduleGraph: { getModulesByFile, invalidateModule },
      watcher,
    })

    expect(watcher.add).toHaveBeenCalledWith([
      fixture.overridePath,
      fixture.targetPath,
    ])

    const undeclared = path.join(
      fixture.projectRoot,
      "src/admin/components/orders/undeclared.tsx"
    )
    fs.writeFileSync(undeclared, "export default function Undeclared() {}\n")
    watcher.emit("add", undeclared)
    expect(invalidateModule).not.toHaveBeenCalled()

    watcher.emit("change", fixture.overridePath)
    expect(invalidateModule).toHaveBeenCalledWith(targetModule)
    expect(invalidateModule).toHaveBeenCalledWith(overrideModule)

    invalidateModule.mockClear()
    watcher.emit("change", fixture.targetPath)
    expect(invalidateModule).toHaveBeenCalledWith(targetModule)
    expect(invalidateModule).toHaveBeenCalledWith(overrideModule)

    invalidateModule.mockClear()
    watcher.emit("unlink", fixture.targetPath)
    expect(invalidateModule).toHaveBeenCalledWith(targetModule)
    expect(invalidateModule).toHaveBeenCalledWith(overrideModule)

    invalidateModule.mockClear()
    watcher.emit("add", fixture.targetPath)
    expect(invalidateModule).toHaveBeenCalledWith(targetModule)
    expect(invalidateModule).toHaveBeenCalledWith(overrideModule)

    invalidateModule.mockClear()
    fs.rmSync(fixture.overridePath)
    watcher.emit("unlink", fixture.overridePath)
    expect(invalidateModule).toHaveBeenCalledWith(targetModule)
    expect(events.at(-1)).toMatchObject({
      kind: "deleted",
      override: fixture.override,
      target: fixture.target,
    })
    await expect(
      resolveTarget(
        plugin,
        fixture.targetPath,
        path.join(fixture.dashboardSrc, "routes/orders/order-list.tsx")
      )
    ).rejects.toThrow(
      `Declared override ${fixture.override} for ${fixture.target} is missing`
    )

    invalidateModule.mockClear()
    fs.writeFileSync(fixture.overridePath, "export default function Restored() {}\n")
    watcher.emit("add", fixture.overridePath)
    expect(invalidateModule).toHaveBeenCalledWith(targetModule)
    expect(events.at(-1)).toMatchObject({
      kind: "restored",
      override: fixture.override,
      target: fixture.target,
    })
    await expect(
      resolveTarget(
        plugin,
        fixture.targetPath,
        path.join(fixture.dashboardSrc, "routes/orders/order-list.tsx")
      )
    ).resolves.toBe(fixture.overridePath)

    expect(
      events.filter(({ kind }) => kind === "deleted" || kind === "restored")
    ).toHaveLength(2)
  })
})

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { customDashboardPlugin } from "../index"

const roots: string[] = []

const createFixture = ({ includeShell = true } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-shell-"))
  roots.push(root)
  const projectRoot = path.join(root, "consumer")
  const dashboardSrc = path.join(
    projectRoot,
    "node_modules/@medusajs/dashboard/src"
  )
  const shellEntry = path.join(dashboardSrc, "exports/shell.ts")
  fs.mkdirSync(path.dirname(shellEntry), { recursive: true })
  if (includeShell) {
    fs.writeFileSync(shellEntry, 'export { Shell } from "../shell"\n')
  }
  return { projectRoot, shellEntry }
}

const resolvePublicShell = async (
  plugin: ReturnType<typeof customDashboardPlugin>,
  source: string
) => {
  const hook =
    typeof plugin.resolveId === "function"
      ? plugin.resolveId
      : plugin.resolveId!.handler
  return hook.call(
    { resolve: vi.fn() } as unknown as ThisParameterType<typeof hook>,
    source,
    undefined,
    { attributes: {}, isEntry: true }
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

describe("public Shell source identity", () => {
  it.each([
    "@mantajs/medusa-dashboard/shell",
    "@medusajs/dashboard/shell",
  ])("resolves %s to the active Dashboard source graph", async (source) => {
    const fixture = createFixture()
    vi.spyOn(process, "cwd").mockReturnValue(fixture.projectRoot)

    await expect(
      resolvePublicShell(customDashboardPlugin(), source)
    ).resolves.toBe(fixture.shellEntry)
  })

  it("does not hijack the unrelated generic Mantajs package", async () => {
    const fixture = createFixture()
    vi.spyOn(process, "cwd").mockReturnValue(fixture.projectRoot)

    await expect(
      resolvePublicShell(
        customDashboardPlugin(),
        "@mantajs/dashboard/shell"
      )
    ).resolves.toBeNull()
  })

  it("fails closed when the active Dashboard lacks its public Shell source", async () => {
    const fixture = createFixture({ includeShell: false })
    vi.spyOn(process, "cwd").mockReturnValue(fixture.projectRoot)

    await expect(
      resolvePublicShell(
        customDashboardPlugin(),
        "@mantajs/medusa-dashboard/shell"
      )
    ).rejects.toThrow(/public Shell source entry is missing/)
  })
})

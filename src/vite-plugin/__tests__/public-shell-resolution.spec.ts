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
  const shellTarget = path.join(
    dashboardSrc,
    "components/layout/shell/shell.tsx"
  )
  const shellOverride = path.join(projectRoot, "src/admin/components/shell.tsx")
  fs.mkdirSync(path.dirname(shellEntry), { recursive: true })
  fs.mkdirSync(path.dirname(shellTarget), { recursive: true })
  fs.mkdirSync(path.dirname(shellOverride), { recursive: true })
  fs.writeFileSync(shellTarget, "export const Shell = () => null\n")
  fs.writeFileSync(shellOverride, "export const Shell = () => null\n")
  if (includeShell) {
    fs.writeFileSync(
      shellEntry,
      'export { Shell } from "../components/layout/shell/shell"\n'
    )
  }
  return { projectRoot, shellEntry, shellOverride, shellTarget }
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

  it("lets an override wrapper import the original public Shell without recursion", async () => {
    const fixture = createFixture()
    vi.spyOn(process, "cwd").mockReturnValue(fixture.projectRoot)
    const plugin = customDashboardPlugin({
      componentOverrides: [
        {
          override: "src/admin/components/shell.tsx",
          target: "src/components/layout/shell/shell.tsx",
        },
      ],
    })
    const hook =
      typeof plugin.resolveId === "function"
        ? plugin.resolveId
        : plugin.resolveId!.handler
    const resolve = vi.fn().mockResolvedValue({ id: fixture.shellTarget })

    await expect(
      hook.call(
        { resolve } as unknown as ThisParameterType<typeof hook>,
        "../components/layout/shell/shell",
        fixture.shellEntry,
        { attributes: {}, isEntry: false }
      )
    ).resolves.toBeNull()
    expect(resolve).not.toHaveBeenCalled()
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

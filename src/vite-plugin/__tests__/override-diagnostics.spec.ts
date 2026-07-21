import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { customDashboardPlugin } from "../index"
import type {
  DashboardOverrideDiagnostic,
  DashboardOverrideSummary,
} from "../types"

const temporaryRoots: string[] = []

const createFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-events-"))
  temporaryRoots.push(root)
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
  fs.writeFileSync(overridePath, "export default function SecretOverride() {}\n")
  fs.writeFileSync(targetPath, "export default function Original() {}\n")

  return { dashboardSrc, override, overridePath, projectRoot, target, targetPath }
}

const hookHandler = <T extends (...args: never[]) => unknown>(
  hook: T | { handler: T }
): T =>
  typeof hook === "function" ? hook : (hook as { handler: T }).handler

const resolveTarget = async (
  plugin: ReturnType<typeof customDashboardPlugin>,
  targetPath: string,
  importer: string
) => {
  const hook = hookHandler(plugin.resolveId!)
  return hook.call(
    { resolve: async () => ({ id: targetPath }) } as never,
    "./order-summary",
    importer,
    { attributes: {}, isEntry: false }
  )
}

const finishBuild = async (plugin: ReturnType<typeof customDashboardPlugin>) => {
  const hook = hookHandler(plugin.buildEnd!)
  await hook.call({} as never)
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

describe("override diagnostics", () => {
  it("emits versioned accepted and applied events without absolute paths or source contents", async () => {
    const fixture = createFixture()
    const events: DashboardOverrideDiagnostic[] = []
    const summaries: DashboardOverrideSummary[] = []
    vi.spyOn(process, "cwd").mockReturnValue(fixture.projectRoot)

    const plugin = customDashboardPlugin({
      componentOverrides: [
        { override: fixture.override, target: fixture.target },
      ],
      onDiagnostic: (event) => events.push(event),
      onSummary: (summary) => summaries.push(summary),
    })

    await resolveTarget(
      plugin,
      fixture.targetPath,
      path.join(fixture.dashboardSrc, "routes/orders/order-list.tsx")
    )
    await finishBuild(plugin)

    expect(events.map(({ kind }) => kind)).toEqual([
      "policy-loaded",
      "accepted",
      "applied",
    ])
    expect(events.every(({ schemaVersion }) => schemaVersion === 1)).toBe(true)
    expect(events.map(({ sequence }) => sequence)).toEqual([0, 1, 2])
    expect(summaries).toEqual([
      {
        accepted: 1,
        applied: 1,
        configured: 1,
        decisions: [
          {
            entry: 0,
            override: fixture.override,
            status: "applied",
            target: fixture.target,
          },
        ],
        rejected: 0,
        schemaVersion: 1,
        unmatched: 0,
      },
    ])

    const serialized = JSON.stringify({ events, summaries })
    expect(serialized).not.toContain(fixture.projectRoot)
    expect(serialized).not.toContain("SecretOverride")
  })

  it("emits a rejected event with the thrown policy reason before build", () => {
    const fixture = createFixture()
    const events: DashboardOverrideDiagnostic[] = []
    const summaries: DashboardOverrideSummary[] = []
    vi.spyOn(process, "cwd").mockReturnValue(fixture.projectRoot)

    let thrown: unknown
    try {
      customDashboardPlugin({
        componentOverrides: [
          {
            override: "src/admin/components/orders/missing.tsx",
            target: fixture.target,
          },
        ],
        onDiagnostic: (event) => events.push(event),
        onSummary: (summary) => summaries.push(summary),
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ reasonCode: "override.missing" })
    expect(events.map(({ kind }) => kind)).toEqual([
      "policy-loaded",
      "rejected",
    ])
    expect(events[1]).toMatchObject({
      entry: 0,
      kind: "rejected",
      reasonCode: "override.missing",
      schemaVersion: 1,
    })
    expect(events[1]).not.toHaveProperty("status")
    expect(summaries[0]).toMatchObject({
      accepted: 0,
      configured: 1,
      rejected: 1,
    })
    expect(JSON.stringify({ events, summaries })).not.toContain(
      fixture.projectRoot
    )
  })

  it("redacts an absolute rejected path from diagnostics and summaries", () => {
    const fixture = createFixture()
    const events: DashboardOverrideDiagnostic[] = []
    const summaries: DashboardOverrideSummary[] = []
    vi.spyOn(process, "cwd").mockReturnValue(fixture.projectRoot)

    expect(() =>
      customDashboardPlugin({
        componentOverrides: [
          { override: fixture.overridePath, target: fixture.target },
        ],
        onDiagnostic: (event) => events.push(event),
        onSummary: (summary) => summaries.push(summary),
      })
    ).toThrow()

    expect(events.at(-1)).toMatchObject({
      kind: "rejected",
      override: "[absolute]",
      reasonCode: "override.absolute",
    })
    expect(summaries[0].decisions[0].override).toBe("[absolute]")
    expect(JSON.stringify({ events, summaries })).not.toContain(
      fixture.projectRoot
    )
  })

  it("reports accepted entries that were never resolved as unmatched", async () => {
    const fixture = createFixture()
    const events: DashboardOverrideDiagnostic[] = []
    let summary: DashboardOverrideSummary | undefined
    vi.spyOn(process, "cwd").mockReturnValue(fixture.projectRoot)

    const plugin = customDashboardPlugin({
      componentOverrides: [
        { override: fixture.override, target: fixture.target },
      ],
      onDiagnostic: (event) => events.push(event),
      onSummary: (value) => {
        summary = value
      },
    })

    expect(plugin.getOverrideSummary()).toMatchObject({
      accepted: 1,
      applied: 0,
      unmatched: 1,
    })
    expect(events.map(({ kind }) => kind)).toEqual([
      "policy-loaded",
      "accepted",
    ])
    expect(summary).toBeUndefined()
    await finishBuild(plugin)

    expect(events.map(({ kind }) => kind)).toEqual([
      "policy-loaded",
      "accepted",
      "unmatched",
    ])
    expect(summary).toMatchObject({ applied: 0, unmatched: 1 })
    expect(summary?.decisions[0]).toMatchObject({ status: "unmatched" })
  })

  it("produces identical decisions in development, preview, and production", async () => {
    const summaries: DashboardOverrideSummary[] = []

    for (const mode of ["development", "preview", "production"]) {
      const fixture = createFixture()
      vi.spyOn(process, "cwd").mockReturnValue(fixture.projectRoot)
      process.env.NODE_ENV = mode
      const plugin = customDashboardPlugin({
        componentOverrides: [
          { override: fixture.override, target: fixture.target },
        ],
        onSummary: (summary) => summaries.push(summary),
      })
      await resolveTarget(
        plugin,
        fixture.targetPath,
        path.join(fixture.dashboardSrc, "routes/orders/order-list.tsx")
      )
      await finishBuild(plugin)
      vi.restoreAllMocks()
    }

    expect(summaries[1]).toEqual(summaries[0])
    expect(summaries[2]).toEqual(summaries[0])
  })
})

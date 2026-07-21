import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { customDashboardPlugin } from "../index"
import { createComponentOverridePolicy } from "../override-policy"

const resolveWithTarget = async (
  plugin: ReturnType<typeof customDashboardPlugin>,
  targetPath: string,
  importer: string
) => {
  const hook =
    typeof plugin.resolveId === "function"
      ? plugin.resolveId
      : plugin.resolveId!.handler

  return hook.call(
    { resolve: async () => ({ id: targetPath }) } as unknown as ThisParameterType<
      typeof hook
    >,
    "./order-summary",
    importer,
    { attributes: {}, isEntry: false }
  )
}

const temporaryRoots: string[] = []

const createFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-policy-"))
  temporaryRoots.push(root)

  const projectRoot = path.join(root, "consumer")
  const dashboardSrc = path.join(
    projectRoot,
    "node_modules",
    "@medusajs",
    "dashboard",
    "src"
  )
  const overrideRelative =
    "src/admin/components/orders/order-summary.tsx"
  const targetRelative = "src/routes/orders/order-summary.tsx"
  const overridePath = path.join(projectRoot, overrideRelative)
  const targetPath = path.join(
    dashboardSrc,
    "routes",
    "orders",
    "order-summary.tsx"
  )

  fs.mkdirSync(path.dirname(overridePath), { recursive: true })
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(overridePath, "export default function Override() {}\n")
  fs.writeFileSync(targetPath, "export default function Original() {}\n")

  return {
    dashboardSrc,
    overridePath,
    overrideRelative,
    projectRoot,
    targetPath,
    targetRelative,
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

describe("component override policy", () => {
  it("never intercepts an undeclared same-name component", async () => {
    const fixture = createFixture()
    const policy = createComponentOverridePolicy([], fixture)

    expect(policy.getOverrideForTarget(fixture.targetPath)).toBeUndefined()

    const cwd = vi.spyOn(process, "cwd").mockReturnValue(fixture.projectRoot)
    try {
      const plugin = customDashboardPlugin()
      const resolved = await resolveWithTarget(
        plugin,
        fixture.targetPath,
        path.join(fixture.dashboardSrc, "routes/orders/order-list.tsx")
      )

      expect(resolved).toBeNull()
    } finally {
      cwd.mockRestore()
    }
  })

  it.each(["development", "preview", "production"])(
    "resolves one exact pair identically in %s mode",
    async (mode) => {
      const fixture = createFixture()
      const policy = createComponentOverridePolicy(
        [
          {
            override: fixture.overrideRelative,
            target: fixture.targetRelative,
          },
        ],
        fixture
      )

      expect(policy.getOverrideForTarget(fixture.targetPath)).toBe(
        fixture.overridePath
      )
      expect(
        policy.getOverrideForTarget(
          path.join(
            fixture.dashboardSrc,
            "components",
            "order-summary.tsx"
          )
        )
      ).toBeUndefined()

      const originalNodeEnv = process.env.NODE_ENV
      const cwd = vi.spyOn(process, "cwd").mockReturnValue(fixture.projectRoot)
      process.env.NODE_ENV = mode
      try {
        const plugin = customDashboardPlugin({
          componentOverrides: [
            {
              override: fixture.overrideRelative,
              target: fixture.targetRelative,
            },
          ],
        })
        const resolved = await resolveWithTarget(
          plugin,
          fixture.targetPath,
          path.join(fixture.dashboardSrc, "routes/orders/order-list.tsx")
        )

        expect(resolved).toBe(fixture.overridePath)
      } finally {
        cwd.mockRestore()
        if (originalNodeEnv === undefined) {
          delete process.env.NODE_ENV
        } else {
          process.env.NODE_ENV = originalNodeEnv
        }
      }
    }
  )

  it("accepts an omitted or empty policy as zero overrides", () => {
    const fixture = createFixture()

    expect(
      createComponentOverridePolicy(undefined, fixture).size
    ).toBe(0)
    expect(createComponentOverridePolicy([], fixture).size).toBe(0)
  })

  it.each([
    ["override", "src/admin/components/orders/missing.tsx"],
    ["target", "src/routes/orders/missing.tsx"],
  ] as const)("rejects a missing %s path", (field, missingPath) => {
    const fixture = createFixture()
    const entry = {
      override: fixture.overrideRelative,
      target: fixture.targetRelative,
      [field]: missingPath,
    }

    expect(() =>
      createComponentOverridePolicy([entry], fixture)
    ).toThrow(new RegExp(`missing ${field}`))
  })

  it("rejects duplicate overrides and duplicate targets", () => {
    const fixture = createFixture()
    const secondOverrideRelative =
      "src/admin/components/orders/second-order-summary.tsx"
    const secondOverridePath = path.join(
      fixture.projectRoot,
      secondOverrideRelative
    )
    const secondTargetRelative =
      "src/routes/orders/second-order-summary.tsx"
    const secondTargetPath = path.join(
      fixture.dashboardSrc,
      "routes",
      "orders",
      "second-order-summary.tsx"
    )
    fs.writeFileSync(secondOverridePath, "export default function Second() {}\n")
    fs.writeFileSync(secondTargetPath, "export default function Second() {}\n")

    expect(() =>
      createComponentOverridePolicy(
        [
          {
            override: fixture.overrideRelative,
            target: fixture.targetRelative,
          },
          {
            override: fixture.overrideRelative,
            target: secondTargetRelative,
          },
        ],
        fixture
      )
    ).toThrow(/duplicate override/)

    expect(() =>
      createComponentOverridePolicy(
        [
          {
            override: fixture.overrideRelative,
            target: fixture.targetRelative,
          },
          {
            override: secondOverrideRelative,
            target: fixture.targetRelative,
          },
        ],
        fixture
      )
    ).toThrow(/duplicate target/)
  })

  it.each([
    ["traversal override", "../override.tsx", "src/routes/orders/order-summary.tsx"],
    ["traversal target", "src/admin/components/orders/order-summary.tsx", "src/../secrets.tsx"],
    ["absolute override", "/tmp/override.tsx", "src/routes/orders/order-summary.tsx"],
    ["absolute target", "src/admin/components/orders/order-summary.tsx", "/tmp/original.tsx"],
    ["override outside root", "src/server/order-summary.tsx", "src/routes/orders/order-summary.tsx"],
    ["target outside root", "src/admin/components/orders/order-summary.tsx", "dist/routes/order-summary.tsx"],
    ["barrel target", "src/admin/components/orders/order-summary.tsx", "src/routes/orders/index.ts"],
    ["unsupported override extension", "src/admin/components/orders/order-summary.css", "src/routes/orders/order-summary.tsx"],
    ["unsupported target extension", "src/admin/components/orders/order-summary.tsx", "src/routes/orders/order-summary.vue"],
  ])("rejects %s", (_name, override, target) => {
    const fixture = createFixture()

    expect(() =>
      createComponentOverridePolicy([{ override, target }], fixture)
    ).toThrow()
  })

  it("rejects an override symlink that resolves outside the approved root", () => {
    const fixture = createFixture()
    const outsidePath = path.join(path.dirname(fixture.projectRoot), "outside.tsx")
    const symlinkRelative = "src/admin/components/orders/external.tsx"
    fs.writeFileSync(outsidePath, "export default function External() {}\n")
    fs.symlinkSync(outsidePath, path.join(fixture.projectRoot, symlinkRelative))

    expect(() =>
      createComponentOverridePolicy(
        [
          {
            override: symlinkRelative,
            target: fixture.targetRelative,
          },
        ],
        fixture
      )
    ).toThrow(/override resolves outside its approved root/)
  })
})

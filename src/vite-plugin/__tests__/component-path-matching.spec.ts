import { describe, expect, it } from "vitest"

import {
  findDashboardComponentForOverride,
  isDashboardComponentFile,
  shouldApplyComponentOverride,
} from "../component-path-matching"

const candidates = [
  "/package/src/components/table/data-table/hooks.tsx",
  "/package/src/providers/keybind-provider/hooks.tsx",
  "/package/src/dashboard-app/forms/hooks.tsx",
]
const override = "/project/src/admin/components/common/table/data-table/hooks.tsx"

describe("component override path matching", () => {
  it("excludes barrel files from the component candidate map", () => {
    expect(
      isDashboardComponentFile(
        "/package/src/components/common/action-menu/index.ts"
      )
    ).toBe(false)
    expect(
      isDashboardComponentFile(
        "/package/src/components/common/action-menu/action-menu.tsx"
      )
    ).toBe(true)
  })

  it("keeps basename matching for the resolved unique dashboard component", () => {
    expect(
      shouldApplyComponentOverride(
        "/package/src/components/common/action-menu.tsx",
        "/project/src/admin/components/action-menu.tsx",
        ["/package/src/components/common/action-menu.tsx"]
      )
    ).toBe(true)
  })

  it("does not replace a barrel or unrelated file with a unique component", () => {
    expect(
      shouldApplyComponentOverride(
        "/package/src/components/common/action-menu/index.ts",
        "/project/src/admin/components/common/action-menu.tsx",
        ["/package/src/components/common/action-menu/action-menu.tsx"]
      )
    ).toBe(false)
  })

  it("matches an ambiguous basename only when its directory suffix agrees", () => {
    expect(
      shouldApplyComponentOverride(candidates[0], override, candidates)
    ).toBe(true)
    expect(
      shouldApplyComponentOverride(candidates[1], override, candidates)
    ).toBe(false)
  })

  it("rejects a less-specific candidate even when it shares a suffix", () => {
    const dataTableCandidates = [
      "/package/src/components/data-table/data-table.tsx",
      "/package/src/components/table/data-table/data-table.tsx",
    ]
    const dataTableOverride =
      "/project/src/admin/components/common/table/data-table/data-table.tsx"

    expect(
      shouldApplyComponentOverride(
        dataTableCandidates[0],
        dataTableOverride,
        dataTableCandidates
      )
    ).toBe(false)
    expect(
      shouldApplyComponentOverride(
        dataTableCandidates[1],
        dataTableOverride,
        dataTableCandidates
      )
    ).toBe(true)
  })

  it("selects the most specific dashboard component for HMR invalidation", () => {
    expect(findDashboardComponentForOverride(override, candidates)).toBe(
      candidates[0]
    )
  })
})

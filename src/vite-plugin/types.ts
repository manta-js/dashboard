import type { ReactNode } from "react"
import type { Plugin } from "vite"

export type MenuNestedItem = {
  label: string
  to: string
  useTranslation?: boolean
}

export type MenuItem = {
  icon: ReactNode
  label: string
  to: string
  useTranslation?: boolean
  items?: MenuNestedItem[]
}

export type MenuConfig = {
  items: MenuItem[]
}

export type DashboardComponentOverride = {
  /** Project-relative module below src/admin/components. */
  override: string
  /** Exact package-relative module below the vendored dashboard src tree. */
  target: string
}

export type DashboardOverrideDiagnosticKind =
  | "policy-loaded"
  | "accepted"
  | "applied"
  | "rejected"
  | "unmatched"
  | "deleted"
  | "restored"

export type DashboardOverrideDiagnostic = {
  schemaVersion: 1
  sequence: number
  kind: DashboardOverrideDiagnosticKind
  configured?: number
  entry?: number
  override?: string
  target?: string
  reasonCode?: string
}

export type DashboardOverrideDecision = {
  entry: number
  override: string
  target: string
  status: "applied" | "rejected" | "unmatched"
  reasonCode?: string
}

export type DashboardOverrideSummary = {
  schemaVersion: 1
  configured: number
  accepted: number
  applied: number
  rejected: number
  unmatched: number
  decisions: DashboardOverrideDecision[]
}

export type DashboardOverridePlugin = Plugin & {
  /** Current deterministic snapshot. Reading it emits no event or callback. */
  getOverrideSummary: () => DashboardOverrideSummary
}

export type CustomDashboardPluginOptions = {
  componentOverrides?: readonly DashboardComponentOverride[]
  /** Called synchronously for each stable, versioned lifecycle event. */
  onDiagnostic?: (event: DashboardOverrideDiagnostic) => void
  /**
   * Called after buildEnd, or immediately when policy validation rejects.
   * Repeated identical summaries are suppressed.
   */
  onSummary?: (summary: DashboardOverrideSummary) => void
}

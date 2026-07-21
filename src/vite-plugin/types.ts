import type { ReactNode } from "react"

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

export type CustomDashboardPluginOptions = {
  componentOverrides?: readonly DashboardComponentOverride[]
}

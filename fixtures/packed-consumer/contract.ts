import Dashboard, {
  type DashboardPlugin,
} from "@mantajs/medusa-dashboard"
import AliasedDashboard from "@medusajs/dashboard"
import {
  LayoutComposer as AliasedLayoutComposer,
} from "@medusajs/dashboard/components"
import {
  customDashboardPlugin as aliasedDashboardPlugin,
} from "@medusajs/dashboard/vite-plugin"
import { LayoutComposer } from "@mantajs/medusa-dashboard/components"
import {
  Shell,
  type ShellProps,
} from "@mantajs/medusa-dashboard/shell"
import "@mantajs/medusa-dashboard/css"
import * as hooks from "@mantajs/medusa-dashboard/hooks"
import {
  customDashboardPlugin,
  type CustomDashboardPluginOptions,
  type DashboardComponentOverride,
  type DashboardOverrideSummary,
} from "@mantajs/medusa-dashboard/vite-plugin"

const dashboard: typeof Dashboard = Dashboard
const aliasedDashboard: typeof Dashboard = AliasedDashboard
const plugin: DashboardPlugin | undefined = undefined
const composer: typeof LayoutComposer = LayoutComposer
const shell: typeof Shell = Shell
const shellProps: ShellProps = {
  topbarActions: null,
  effects: null,
}
const options: CustomDashboardPluginOptions = {}
const override: DashboardComponentOverride = {
  override: "src/admin/components/orders/order-list.tsx",
  target: "src/routes/orders/order-list/order-list.tsx",
}
const summary: DashboardOverrideSummary | undefined = undefined

void dashboard
void aliasedDashboard
void AliasedLayoutComposer
void aliasedDashboardPlugin
void plugin
void composer
void shell
void shellProps
void hooks
void customDashboardPlugin
void options
void override
void summary

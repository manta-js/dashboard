import {
  Shell as DashboardShell,
  type ShellProps,
} from "@mantajs/medusa-dashboard/shell"

export const Shell = (props: ShellProps) => (
  <DashboardShell {...props} topbarActions={<span>Consumer action</span>} />
)

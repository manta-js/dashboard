import type { PropsWithChildren, ReactNode } from "react"

export type ShellProps = PropsWithChildren<{
  /** Product-owned controls rendered before the built-in notifications control. */
  topbarActions?: ReactNode
  /** Product-owned, non-visual effects that must follow the authenticated shell lifecycle. */
  effects?: ReactNode
}>

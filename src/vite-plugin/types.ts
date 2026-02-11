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

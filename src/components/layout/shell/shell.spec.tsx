// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useEffect } from "react"
import { createMemoryRouter, RouterProvider } from "react-router-dom"

vi.hoisted(() => {
  const runtime = global as typeof globalThis & Record<string, unknown>
  runtime.__BACKEND_URL__ = "http://localhost:9000"
  runtime.__AUTH_TYPE__ = "session"
  runtime.__JWT_TOKEN_STORAGE_KEY__ = ""
})

import { SidebarProvider } from "../../../providers/sidebar-provider"
import { Shell } from "./shell"

type PublicShell = typeof import("../../../exports/shell-types").Shell
const publicShellContract: PublicShell = Shell
void publicShellContract

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("../notifications", () => ({
  Notifications: () => <div data-testid="notifications" />,
}))

vi.mock("../../../providers/keybind-provider/hooks", () => ({
  useGlobalShortcuts: () => [],
  useShortcuts: () => undefined,
}))

afterEach(cleanup)

describe("Shell extension boundary", () => {
  it("renders product actions and effects without replacing built-in notifications", async () => {
    const cleanupEffect = vi.fn()
    const PresenceEffect = () => {
      useEffect(() => cleanupEffect, [])
      return <div data-testid="presence-heartbeat" />
    }
    const router = createMemoryRouter([
      {
        path: "/",
        element: (
          <SidebarProvider>
            <Shell
              topbarActions={<button type="button">Messages</button>}
              effects={<PresenceEffect />}
            >
              <div>Navigation</div>
            </Shell>
          </SidebarProvider>
        ),
        children: [{ index: true, element: <div>Dashboard</div> }],
      },
    ])

    const rendered = render(<RouterProvider router={router} />)

    expect(await screen.findByRole("button", { name: "Messages" })).toBeTruthy()
    expect(screen.getByTestId("presence-heartbeat")).toBeTruthy()
    expect(screen.getByTestId("notifications")).toBeTruthy()
    expect(screen.getByText("Dashboard")).toBeTruthy()

    rendered.unmount()
    expect(cleanupEffect).toHaveBeenCalledOnce()
  })
})

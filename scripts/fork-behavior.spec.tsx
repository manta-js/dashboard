import { z } from "zod"

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  dashboardConstructor: vi.fn(),
  useForm: vi.fn(),
}))

vi.mock("../src/dashboard-app", () => ({
  DashboardApp: class {
    constructor(options: unknown) {
      mocks.dashboardConstructor(options)
    }

    render() {
      return null
    }
  },
}))

vi.mock("react-hook-form", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-hook-form")>()),
  useForm: mocks.useForm,
}))

vi.mock("virtual:medusa/links", () => ({
  default: {
    links: {
      product: ["variants"],
    },
  },
}))

import App from "../src/app"
import { useExtendableForm } from "../src/dashboard-app/forms/hooks"
import { getLinkedFields } from "../src/dashboard-app/links/utils"

beforeEach(() => {
  mocks.dashboardConstructor.mockClear()
  mocks.useForm.mockClear()
})

describe("fork-owned dashboard behavior", () => {
  it("places consumer plugins before the package-local plugin", () => {
    const consumerPlugin = { marker: "consumer" }

    App({ plugins: [consumerPlugin] as never })

    const plugins = mocks.dashboardConstructor.mock.calls[0][0].plugins
    expect(plugins[0]).toBe(consumerPlugin)
    expect(plugins[1]).toMatchObject({
      displayModule: expect.any(Object),
      formModule: expect.any(Object),
      routeModule: expect.any(Object),
      widgetModule: expect.any(Object),
    })
  })

  it("does not mutate caller-owned form defaults", () => {
    const defaults = { title: "Original" }
    const form = { marker: "form" }
    mocks.useForm.mockReturnValue(form)

    const result = useExtendableForm({
      configs: [],
      defaultValues: defaults,
      schema: z.object({ title: z.string() }),
    })

    expect(result).toBe(form)
    expect(defaults).toEqual({ title: "Original" })
    expect(mocks.useForm.mock.calls[0][0].defaultValues).toEqual({
      title: "Original",
      additional_data: {},
    })
    expect(mocks.useForm.mock.calls[0][0].defaultValues).not.toBe(defaults)
  })

  it("does not prefix linked fields with an empty query segment", () => {
    expect(getLinkedFields("product" as never)).toBe("+variants.*")
    expect(getLinkedFields("product" as never, "id,title")).toBe(
      "id,title,+variants.*"
    )
  })
})

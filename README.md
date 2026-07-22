# @mantajs/medusa-dashboard

A customizable fork of `@medusajs/dashboard` that lets you **override components**, **override routes**, and **define your own sidebar menu** — without modifying the original dashboard source code.

Drop-in replacement for `@medusajs/dashboard` via package manager resolutions/overrides.

## Candidate status

OLI-398 prepares `@mantajs/medusa-dashboard` but does not publish it. The B2B
application remains pinned to the rollback package
`@mantajs/dashboard@0.1.18-medusa.0` until OLI-405 proves and authorizes its
migration. See [the staged package migration](docs/PACKAGE_MIGRATION.md).

For local candidate validation, install the tarball produced by `yarn pack`:

```bash
yarn add file:/path/to/mantajs-medusa-dashboard.tgz
```

The future package retains the Medusa-specific prerelease suffix and `medusa`
dist-tag. The generic `@mantajs/dashboard` `0.2.x` line is unrelated and must
never be overwritten or deprecated by this migration.

### Using as a dashboard replacement

In a disposable validation project, alias `@medusajs/dashboard` to the packed
candidate. OLI-405 owns the equivalent B2B change.

#### Yarn (v1 & v4+)

```json
{
  "resolutions": {
    "@medusajs/dashboard": "file:/path/to/mantajs-medusa-dashboard.tgz"
  }
}
```

Then register the Vite plugin in your `medusa-config.ts`:

```ts
import { defineConfig } from "@medusajs/framework/config"
import { customDashboardPlugin } from "@mantajs/medusa-dashboard/vite-plugin"

export default defineConfig({
  // ...
  admin: {
    vite: () => ({
      plugins: [
        customDashboardPlugin({
          componentOverrides: [
            {
              override: "src/admin/components/orders/order-activity-section.tsx",
              target: "src/routes/orders/order-detail/components/order-activity-section/order-activity-section.tsx",
            },
          ],
        }),
      ],
    }),
  },
})
```

Run `medusa build` (or `medusa develop`) and the custom dashboard will be compiled in place of the stock one.

## Features

### 1. Component Overrides

Component replacement is opt-in. Each override must declare both its
project-relative module and its exact vendored dashboard target. Files are never
authorized by directory scan or filename equality.

```
your-project/
└── src/
    └── admin/
        └── components/
            ├── product-general-section.tsx          ← flat override (works)
            ├── orders/
            │   └── order-activity-section.tsx        ← nested override (works too)
            └── forms/
                └── shipping-address-form.tsx         ← deeply nested (works too)
```

The policy is validated fail-closed before resolution. Missing files, duplicate
targets, traversal, unsupported extensions, and stale vendored targets stop the
build with structured diagnostics.

Your override component must export a `default` export:

```tsx
// src/admin/components/orders/order-activity-section.tsx
const OrderActivitySection = () => {
  return <div>My custom order activity section</div>
}

export default OrderActivitySection
```

**Developer experience (HMR):**

| Action | Behavior | Details |
|--------|----------|---------|
| **Modify** an override | **HMR** (Hot Module Replacement) | The component is swapped in-place — no page reload, no React state loss. Instant feedback. |
| **Create** a declared override | **HMR update** | The exact configured target is invalidated; undeclared files remain inert. |
| **Delete** a declared override | **Fail closed** | The exact configured target is invalidated and a deletion diagnostic is emitted. |

Under the hood, override files are kept as **separate Vite modules** (not
inlined into the pre-bundled chunk). React Fast Refresh handles modifications;
creation and deletion invalidate only the declared target.

**Important notes:**

- Omitted or empty `componentOverrides` means zero component replacements.
- Only exact configured target paths can be replaced.
- Duplicate targets and ambiguous policy entries are rejected.
- Index/barrel files (`index.ts`) are never overridden to preserve re-exports.
- The plugin forces Vite to re-optimize dependencies when overrides are present, so changes are always picked up.

### 2. Route Overrides

Add new pages or replace existing ones using Medusa's standard admin extension system.

```
your-project/
└── src/
    └── admin/
        └── routes/
            └── custom-page/
                └── page.tsx          ← adds /custom-page to the dashboard
            └── orders/
                └── page.tsx          ← overrides the /orders page
```

**How merging works:**

- If your extension route has a path that **doesn't exist** in the dashboard, it's added as a new route.
- If your extension route has the **same path** as a built-in route, your component **replaces** the original.
- Children of the original route that you **don't redefine** are preserved. For example, overriding `/orders` keeps `/orders/:id` intact.

This uses Medusa's `@medusajs/admin-vite-plugin` to discover routes in `src/admin/routes/`, combined with a custom merge function that ensures backward compatibility.

**Route page example:**

```tsx
// src/admin/routes/orders/page.tsx
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ShoppingCart } from "@medusajs/icons"
import { Container, Heading } from "@medusajs/ui"

const OrdersPage = () => {
  return (
    <Container>
      <Heading level="h1">My Custom Orders Page</Heading>
      {/* Your custom orders list */}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Orders",
  icon: ShoppingCart,
})

export default OrdersPage
```

**Developer experience:**

Route overrides use Medusa's standard admin extension system (`@medusajs/admin-vite-plugin`), which provides its own HMR. Modifying a route page triggers a standard Vite HMR update — the page refreshes instantly without a full reload.

**Component overrides vs Route overrides — when to use which:**

| Use case | Approach |
|----------|----------|
| Replace a **full page** (e.g., the orders list) | Route override (`src/admin/routes/orders/page.tsx`) |
| Replace a **section** inside a page (e.g., the customer info block in order detail) | Component override (`src/admin/components/order-customer-section.tsx`) |
| Add a **new page** that doesn't exist in the dashboard | Route override (`src/admin/routes/my-page/page.tsx`) |
| Tweak a **reusable UI element** used across multiple pages | Component override |

### 3. Custom Menu Configuration

Define your own sidebar menu by creating a `src/admin/menu.config.tsx` file:

```
your-project/
└── src/
    └── admin/
        └── menu.config.tsx
```

```tsx
// src/admin/menu.config.tsx
import { ShoppingCart, Users, BuildingStorefront } from "@medusajs/icons"
import type { MenuConfig } from "@mantajs/medusa-dashboard/vite-plugin"

const config: MenuConfig = {
  items: [
    {
      icon: <ShoppingCart />,
      label: "orders.domain",
      to: "/orders",
      useTranslation: true,
    },
    {
      icon: <Users />,
      label: "customers.domain",
      to: "/customers",
      useTranslation: true,
    },
    {
      icon: <BuildingStorefront />,
      label: "My Custom Page",
      to: "/custom-page",
      items: [
        { label: "Sub Page", to: "/custom-page/sub" },
      ],
    },
  ],
}

export default config
```

**Menu item properties:**

| Property | Type | Description |
|----------|------|-------------|
| `icon` | `ReactNode` | Icon component (use `@medusajs/icons`) |
| `label` | `string` | Display label or i18n translation key |
| `to` | `string` | Route path |
| `useTranslation` | `boolean` | If `true`, `label` is treated as an i18n key |
| `items` | `MenuNestedItem[]` | Optional nested items |

**Types:**

```ts
import type { MenuConfig, MenuItem, MenuNestedItem } from "@mantajs/medusa-dashboard/vite-plugin"
```

When no `menu.config.ts` is found, the dashboard falls back to its built-in sidebar menu.

### Menu, Nested Routes, and Modules: How They Interact

Understanding how the sidebar menu is built is critical to avoid duplicate or missing entries. There are **three sources** that can add items to the sidebar:

1. **Your `menu.config.tsx`** — the custom menu you define
2. **Route configs with `nested`** — pages that declare `nested: "/parent"` in `defineRouteConfig()`
3. **Plugin modules** — modules like `@medusajs/draft-order` that register their own routes and menu entries

#### How `nested` works

When a route page exports a config with `nested`, Medusa **automatically injects** it as a sub-item under the specified parent in the sidebar:

```tsx
// src/admin/routes/draft-orders/page.tsx
export const config = defineRouteConfig({
  label: "Drafts",
  nested: "/orders",   // ← auto-injected under Orders in the sidebar
})
```

This happens **regardless** of your `menu.config.tsx`. Even if you define a custom menu, any route with `nested` will still be injected as a child of its parent entry.

**To prevent a route from appearing in the sidebar**, remove the `nested` property:

```tsx
export const config = defineRouteConfig({
  label: "Drafts Test",
  // no `nested` → not auto-injected in the menu
})
```

The page remains accessible via its URL (`/app/draft-orders`) but won't appear in the sidebar unless you explicitly add it to your menu config.

#### Controlling sub-items via `menu.config.tsx`

If you want full control over which sub-items appear under a menu entry, define them explicitly in `items`:

```tsx
{
  icon: <ShoppingCart />,
  label: "orders.domain",
  useTranslation: true,
  to: "/orders",
  items: [
    { label: "Draft Orders", to: "/draft-orders" },
  ],
}
```

**Important:** Nested routes (`nested: "/orders"`) are still injected even if you define `items` manually. To avoid duplicates, either:
- Remove `nested` from the route config, **or**
- Don't list the route in `items` (let `nested` handle it)

Never do both — you'll get a duplicate entry.

#### Plugin modules and the Extensions section

Medusa plugin modules (e.g., `@medusajs/draft-order`) register their own sidebar entries. By default, these appear in the **Extensions** section at the bottom of the sidebar.

When you include a module's route in your `menu.config.tsx`, the module's entry is **absorbed** into your custom menu and no longer appears separately in Extensions:

```tsx
// Including /draft-orders in the custom menu prevents it from
// appearing again under Extensions
{
  icon: <ShoppingCart />,
  label: "Orders",
  to: "/orders",
  items: [
    { label: "Draft Orders", to: "/draft-orders" },  // ← module route
  ],
}
```

If you **don't** include a module's route in your menu config, it will appear in the Extensions section as usual.

#### Summary

| Scenario | Result |
|----------|--------|
| Route has `nested: "/orders"` | Auto-injected under Orders in sidebar |
| Route has no `nested` | Not in sidebar (unless in `menu.config.tsx`) |
| Module route listed in `menu.config.tsx` | Appears in your menu, not in Extensions |
| Module route **not** in `menu.config.tsx` | Appears in Extensions section |
| Route has `nested` **and** listed in `items` | Duplicate entry (avoid this!) |

## Exports

| Import | Description |
|--------|-------------|
| `@mantajs/medusa-dashboard` | Main dashboard app (DashboardPlugin type, render function) |
| `@mantajs/medusa-dashboard/components` | Medusa public components, including `LayoutComposer` |
| `@mantajs/medusa-dashboard/hooks` | Medusa public dashboard hooks |
| `@mantajs/medusa-dashboard/css` | Dashboard stylesheet |
| `@mantajs/medusa-dashboard/vite-plugin` | Vite plugin + menu and override policy types |

## Development

```bash
# Install dependencies
yarn install

# Start dev server (standalone dashboard)
yarn dev

# Build for distribution
yarn build

# Run tests
yarn test

# Validate i18n translations
yarn i18n:validate
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_MEDUSA_BACKEND_URL` | `http://localhost:9000` | Medusa backend URL |
| `VITE_MEDUSA_STOREFRONT_URL` | `http://localhost:8000` | Storefront URL |
| `VITE_MEDUSA_BASE` | `/` | Base path for the dashboard |
| `VITE_MEDUSA_PROJECT` | — | Path to a Medusa project to load admin extensions from |

## Compatibility

- **Medusa v2** (2.16.x)
- **React 18**
- **Vite 5**
- **TypeScript 5.6+**

## Release policy

npm publication occurs only from a published GitHub Release. The release tag
must exactly equal `v<package.version>`, target `main`, and reference a commit
contained in `main`. The workflow reruns `yarn verify`, requires the protected
`npm-medusa-dashboard` environment, and refuses publication while the transition
manifest lacks explicitly authorized OLI-405 evidence for either an immutable
green PR head or a merged PR. A validated head breaks the bootstrap dependency
cycle; it does not itself authorize publication. At release time the protected
environment's `B2B_RELEASE_VALIDATION_TOKEN` must also prove the private B2B PR,
its `refactor` base, exact SHA, and required checks with conclusion `success`
through GitHub. The transition manifest separately attests Dashboard candidate
commit `8723df1c922e98b1fe74a28f38edee4d47a20b23` and tarball SHA-256
`0ecca5c6c4908c6577299153a63e10be47ce9d0afbe4ecf296254014825518da`.
The protected workflow rebuilds that commit in a fresh worktree, normalizes the
archive timestamps, ownership and POSIX modes, verifies its internal package
manifest and exact archive hash,
and publishes the verified tarball instead of the authorization commit. OLI-398 and
OLI-415 leave the manifest locked.

## License

[MIT](LICENSE)

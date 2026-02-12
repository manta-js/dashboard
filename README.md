# @mantajs/dashboard

A customizable fork of `@medusajs/dashboard` that lets you **override components**, **override routes**, and **define your own sidebar menu** — without modifying the original dashboard source code.

Drop-in replacement for `@medusajs/dashboard` via package manager resolutions/overrides.

## Installation

```bash
# Yarn
yarn add @mantajs/dashboard

# npm
npm install @mantajs/dashboard

# pnpm
pnpm add @mantajs/dashboard
```

### Using as a dashboard replacement

In your Medusa backend's `package.json`, add a resolution/override to swap `@medusajs/dashboard` with `@mantajs/dashboard`. The syntax depends on your package manager:

#### Yarn (v1 & v4+)

```json
{
  "resolutions": {
    "@medusajs/dashboard": "npm:@mantajs/dashboard@^0.1.13"
  }
}
```

#### npm (v8.3+)

```json
{
  "overrides": {
    "@medusajs/dashboard": "npm:@mantajs/dashboard@^0.1.13"
  }
}
```

#### pnpm

```json
{
  "pnpm": {
    "overrides": {
      "@medusajs/dashboard": "npm:@mantajs/dashboard@^0.1.13"
    }
  }
}
```

Then register the Vite plugin in your `medusa-config.ts`:

```ts
import { defineConfig } from "@medusajs/framework/config"
import { customDashboardPlugin } from "@mantajs/dashboard/vite-plugin"

export default defineConfig({
  // ...
  admin: {
    vite: () => ({
      plugins: [customDashboardPlugin()],
    }),
  },
})
```

Run `medusa build` (or `medusa develop`) and the custom dashboard will be compiled in place of the stock one.

## Features

### 1. Component Overrides

Replace any dashboard component by placing a file with the **same name** in your project's `src/admin/components/` directory. The plugin **recursively scans** the entire `components/` tree, so you can organize overrides in subdirectories.

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

**How it works:**

During Vite's pre-bundling phase, the plugin redirects the dashboard's `dist/app.mjs` entry to source files. It then intercepts individual source file loads and swaps any component whose filename matches one of your overrides.

Matching is done by **file name** (without extension), regardless of subdirectory depth. For example:

| Your file | Overrides |
|-----------|-----------|
| `product-general-section.tsx` | `src/routes/products/.../product-general-section.tsx` |
| `orders/order-list.tsx` | `src/routes/orders/order-list/order-list.tsx` |
| `layout/main-layout.tsx` | `src/components/layout/main-layout/main-layout.tsx` |

Your override component must export a `default` export:

```tsx
// src/admin/components/orders/order-activity-section.tsx
const OrderActivitySection = () => {
  return <div>My custom order activity section</div>
}

export default OrderActivitySection
```

**Important notes:**

- Override files are discovered **recursively** in `src/admin/components/` and all its subdirectories.
- Matching is based on **file name only** — the subdirectory structure is for your own organization and does not affect matching.
- If two files in different subdirectories share the same name, the plugin logs a warning in development and uses the one that comes last alphabetically by full path.
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
import type { MenuConfig } from "@mantajs/dashboard/vite-plugin"

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
import type { MenuConfig, MenuItem, MenuNestedItem } from "@mantajs/dashboard/vite-plugin"
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
| `@mantajs/dashboard` | Main dashboard app (DashboardPlugin type, render function) |
| `@mantajs/dashboard/css` | Dashboard stylesheet |
| `@mantajs/dashboard/vite-plugin` | Vite plugin + menu types |

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

- **Medusa v2** (2.13.x)
- **React 18**
- **Vite 5**
- **TypeScript 5.6+**

## License

[MIT](LICENSE)

import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const root = resolve(import.meta.dirname, "..")
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8")
)

const expectedExports = {
  ".": ["types", "import", "require"],
  "./components": ["types", "import", "require"],
  "./hooks": ["types", "import", "require"],
  "./css": ["import", "require"],
  "./vite-plugin": ["types", "import", "require"],
  "./root": null,
  "./package.json": null,
}

assert.match(packageJson.version, /^\d+\.\d+\.\d+-medusa\.\d+$/)
assert.equal(packageJson.publishConfig?.tag, "medusa")

for (const [subpath, conditions] of Object.entries(expectedExports)) {
  assert.ok(packageJson.exports[subpath], `missing export ${subpath}`)
  if (conditions) {
    for (const condition of conditions) {
      assert.equal(
        typeof packageJson.exports[subpath][condition],
        "string",
        `missing ${condition} condition for ${subpath}`
      )
    }
  }
}

const expectedFiles = [
  "dist/app.js",
  "dist/app.mjs",
  "dist/app.css",
  "dist/index.d.ts",
  "dist/components.js",
  "dist/components.mjs",
  "dist/components.d.ts",
  "dist/hooks.js",
  "dist/hooks.mjs",
  "dist/hooks.d.ts",
  "dist/vite-plugin/index.js",
  "dist/vite-plugin/index.mjs",
  "dist/vite-plugin/index.d.ts",
]

await Promise.all(expectedFiles.map((file) => access(resolve(root, file))))

const components = await import(
  pathToFileURL(resolve(root, "dist/components.mjs")).href
)
const vitePlugin = await import(
  pathToFileURL(resolve(root, "dist/vite-plugin/index.mjs")).href
)

assert.equal(typeof components.LayoutComposer, "function")
assert.equal(typeof vitePlugin.customDashboardPlugin, "function")
assert.equal(vitePlugin.menuConfigPlugin, vitePlugin.customDashboardPlugin)

console.log(
  `Package contract passed for ${packageJson.name}@${packageJson.version}`
)

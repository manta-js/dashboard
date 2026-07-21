import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const root = resolve(import.meta.dirname, "..")
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8")
)
const transition = JSON.parse(
  await readFile(
    resolve(root, "release/medusa-dashboard-transition.json"),
    "utf8"
  )
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

assert.equal(packageJson.name, "@mantajs/medusa-dashboard")
assert.match(packageJson.version, /^\d+\.\d+\.\d+-medusa\.\d+$/)
assert.equal(packageJson.publishConfig?.tag, "medusa")
assert.equal(transition.to?.package, packageJson.name)
assert.equal(transition.to?.version, packageJson.version)
assert.equal(transition.from?.package, "@mantajs/dashboard")
assert.equal(transition.from?.version, "0.1.18-medusa.0")
assert.equal(transition.authorization?.owner, "OLI-405")
assert.ok(
  ["awaiting-oli-405", "authorized-after-oli-405"].includes(
    transition.state
  ),
  "unknown package transition state"
)
if (transition.state === "awaiting-oli-405") {
  assert.equal(transition.authorization?.authorized, false)
  assert.equal(transition.authorization?.evidence, null)
} else {
  assert.equal(transition.authorization?.authorized, true)
  assert.match(
    transition.authorization?.evidence?.pullRequest || "",
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/
  )
  assert.match(
    transition.authorization?.evidence?.mergeCommit || "",
    /^[0-9a-f]{40}$/
  )
}

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

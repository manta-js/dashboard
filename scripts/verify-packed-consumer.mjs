import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
// B2B currently consumes the package through Yarn 4's node-modules linker.
const B2B_YARN_VERSION = "4.12.0"
const temporaryRoot = mkdtempSync(join(tmpdir(), "mantajs-dashboard-consumer-"))
const packageDirectory = join(temporaryRoot, "package")
const consumerDirectory = join(temporaryRoot, "consumer")
const childEnvironment = {
  ...process.env,
  CI: "1",
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  // The disposable consumer intentionally starts without a lockfile. Its first
  // install must be allowed to create one even when the parent CI is immutable.
  YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
}

try {
  mkdirSync(packageDirectory)
  mkdirSync(consumerDirectory)

  const [packedPackage] = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--pack-destination", packageDirectory],
      { cwd: root, encoding: "utf8", env: childEnvironment }
    )
  )

  const packedFiles = packedPackage.files.map(({ path }) => path)
  const tarball = join(packageDirectory, packedPackage.filename)

  assert.ok(packedFiles.includes("dist/components.mjs"))
  assert.ok(packedFiles.includes("dist/components.d.ts"))
  assert.ok(packedFiles.includes("dist/vite-plugin/index.mjs"))
  assert.ok(packedFiles.includes("src/app.tsx"))
  assert.ok(packedFiles.includes("src/vite-plugin/index.ts"))

  writeFileSync(
    join(consumerDirectory, "package.json"),
    JSON.stringify(
      {
        private: true,
        packageManager: `yarn@${B2B_YARN_VERSION}`,
        dependencies: {
          "@medusajs/dashboard": "2.16.0",
        },
        devDependencies: {
          "@types/node": rootPackage.devDependencies["@types/node"],
          "@types/react": rootPackage.devDependencies["@types/react"],
          typescript: rootPackage.devDependencies.typescript,
          vite: rootPackage.peerDependencies.vite,
        },
        resolutions: {
          "@medusajs/dashboard": `file:${tarball}`,
        },
      },
      null,
      2
    )
  )
  writeFileSync(join(consumerDirectory, ".yarnrc.yml"), "nodeLinker: node-modules\n")
  writeFileSync(
    join(consumerDirectory, "contract.ts"),
    [
      'import Dashboard, { type DashboardPlugin } from "@medusajs/dashboard"',
      'import { LayoutComposer } from "@medusajs/dashboard/components"',
      'import { customDashboardPlugin } from "@medusajs/dashboard/vite-plugin"',
      "const dashboard: typeof Dashboard = Dashboard",
      "const plugin: DashboardPlugin | undefined = undefined",
      "const composer: typeof LayoutComposer = LayoutComposer",
      "void dashboard",
      "void plugin",
      "void composer",
      "customDashboardPlugin()",
    ].join("\n")
  )
  writeFileSync(
    join(consumerDirectory, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          jsx: "react-jsx",
          lib: ["ESNext", "DOM"],
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ES2022",
        },
        include: ["contract.ts"],
      },
      null,
      2
    )
  )
  execFileSync("corepack", ["yarn", "install"], {
    cwd: consumerDirectory,
    stdio: "inherit",
    env: childEnvironment,
  })

  const proof = execFileSync(
    "corepack",
    [
      "yarn",
      "node",
      "--input-type=module",
      "--eval",
      [
        'import { LayoutComposer } from "@medusajs/dashboard/components"',
        'import { customDashboardPlugin } from "@medusajs/dashboard/vite-plugin"',
        'import packageJson from "@medusajs/dashboard/package.json" with { type: "json" }',
        'const rootUrl = import.meta.resolve("@medusajs/dashboard")',
        'const cssUrl = import.meta.resolve("@medusajs/dashboard/css")',
        'const hooksUrl = import.meta.resolve("@medusajs/dashboard/hooks")',
        'const dashboardVitePlugin = customDashboardPlugin()',
        'const viteConfig = {}',
        'dashboardVitePlugin.config(viteConfig)',
        'if (typeof LayoutComposer !== "function") throw new Error("LayoutComposer missing")',
        'if (typeof customDashboardPlugin !== "function") throw new Error("vite plugin missing")',
        'if (packageJson.name !== "@mantajs/dashboard") throw new Error("alias did not install Manta")',
        `if (packageJson.version !== ${JSON.stringify(rootPackage.version)}) throw new Error(\`version mismatch: \${packageJson.version}\`)`,
        'if (dashboardVitePlugin.name !== "custom-dashboard") throw new Error("plugin instance mismatch")',
        'if (!viteConfig.optimizeDeps?.entries?.some((entry) => entry.endsWith("/node_modules/@medusajs/dashboard/src/app.tsx"))) throw new Error("installed dashboard source was not discovered")',
        'if (!rootUrl.endsWith("/dist/app.mjs")) throw new Error(`root export mismatch: ${rootUrl}`)',
        'if (!cssUrl.endsWith("/dist/app.css")) throw new Error(`css export mismatch: ${cssUrl}`)',
        'if (!hooksUrl.endsWith("/dist/hooks.mjs")) throw new Error(`hooks export mismatch: ${hooksUrl}`)',
        'console.log(`${packageJson.name}@${packageJson.version} installed as @medusajs/dashboard`)',
      ].join(";"),
    ],
    { cwd: consumerDirectory, encoding: "utf8", env: childEnvironment }
  )

  console.log(proof.trim())

  execFileSync(
    "corepack",
    [
      "yarn",
      "node",
      "--input-type=commonjs",
      "--eval",
      [
        'const components = require("@medusajs/dashboard/components")',
        'const hooks = require("@medusajs/dashboard/hooks")',
        'const vitePlugin = require("@medusajs/dashboard/vite-plugin")',
        'if (typeof components.LayoutComposer !== "function") throw new Error("CJS LayoutComposer missing")',
        'if (typeof hooks !== "object") throw new Error("CJS hooks export invalid")',
        'if (typeof vitePlugin.customDashboardPlugin !== "function") throw new Error("CJS vite plugin missing")',
        'require.resolve("@medusajs/dashboard")',
        'require.resolve("@medusajs/dashboard/css")',
      ].join(";"),
    ],
    { cwd: consumerDirectory, stdio: "inherit", env: childEnvironment }
  )

  execFileSync("corepack", ["yarn", "tsc", "--project", "tsconfig.json"], {
    cwd: consumerDirectory,
    stdio: "inherit",
    env: childEnvironment,
  })
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}

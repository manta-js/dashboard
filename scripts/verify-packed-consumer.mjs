import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const rootPackage = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8")
)
const YARN_VERSION = "4.12.0"
const temporaryRoot = mkdtempSync(join(tmpdir(), "mantajs-dashboard-consumer-"))
const packageDirectory = join(temporaryRoot, "package")
const consumerDirectory = join(temporaryRoot, "consumer")
const fixtureDirectory = join(root, "fixtures/packed-consumer")
const childEnvironment = {
  ...process.env,
  CI: "1",
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
}

const listFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })

const assertPublicConsumerImports = () => {
  const sourceFiles = listFiles(fixtureDirectory).filter((file) =>
    /\.(?:[cm]?[jt]s|tsx)$/.test(file)
  )
  const source = sourceFiles
    .map(
      (file) =>
        `${relative(fixtureDirectory, file)}\n${readFileSync(file, "utf8")}`
    )
    .join("\n")

  assert.doesNotMatch(
    source,
    /(?:from\s+|import\s*\(|require\s*\()["'](?:@mantajs\/medusa-dashboard|@medusajs\/dashboard)\/(?:src|dist)\//,
    "consumer fixtures must not import package internals"
  )
  assert.doesNotMatch(
    source,
    /(?:component-path-matching|production-component-override|resolveDashboardComponent|\bresolveId\s*\([^)]*\)\s*\{|\bresolveId\s*:\s*(?:async\s*)?\()/,
    "consumer fixtures must not contain a second override resolver"
  )
  const allowedPackageReferences = new Set([
    "@mantajs/medusa-dashboard",
    "@mantajs/medusa-dashboard/components",
    "@mantajs/medusa-dashboard/css",
    "@mantajs/medusa-dashboard/hooks",
    "@mantajs/medusa-dashboard/package.json",
    "@mantajs/medusa-dashboard/shell",
    "@mantajs/medusa-dashboard/vite-plugin",
    "@medusajs/dashboard",
    "@medusajs/dashboard/components",
    "@medusajs/dashboard/css",
    "@medusajs/dashboard/hooks",
    "@medusajs/dashboard/package.json",
    "@medusajs/dashboard/shell",
    "@medusajs/dashboard/vite-plugin",
  ])
  for (const match of source.matchAll(
    /["'`](@mantajs\/medusa-dashboard(?:\/[\w./-]+)?|@medusajs\/dashboard(?:\/[\w./-]+)?)["'`]/g
  )) {
    assert.ok(
      allowedPackageReferences.has(match[1]),
      `consumer fixture references undeclared package subpath ${match[1]}`
    )
  }
  assert.equal(
    (source.match(/customDashboardPlugin\s*\(/g) || []).length,
    1,
    "consumer fixtures must define exactly one customDashboardPlugin mechanism"
  )
}

try {
  assertPublicConsumerImports()
  mkdirSync(packageDirectory)
  cpSync(fixtureDirectory, consumerDirectory, { recursive: true })

  const [packedPackage] = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--pack-destination", packageDirectory],
      { cwd: root, encoding: "utf8", env: childEnvironment }
    )
  )
  const packedFiles = packedPackage.files.map(({ path }) => path)
  const tarball = join(packageDirectory, packedPackage.filename)

  assert.equal(packedPackage.name, "@mantajs/medusa-dashboard")
  for (const file of [
    "dist/app.js",
    "dist/app.mjs",
    "dist/app.css",
    "dist/index.d.ts",
    "dist/components.js",
    "dist/components.mjs",
    "dist/components.d.ts",
    "dist/shell.js",
    "dist/shell.mjs",
    "dist/shell.d.ts",
    "dist/hooks.js",
    "dist/hooks.mjs",
    "dist/hooks.d.ts",
    "dist/vite-plugin/index.js",
    "dist/vite-plugin/index.mjs",
    "dist/vite-plugin/index.d.ts",
  ]) {
    assert.ok(packedFiles.includes(file), `packed candidate is missing ${file}`)
  }

  const consumerPackage = JSON.parse(
    readFileSync(join(consumerDirectory, "package.json"), "utf8")
  )
  consumerPackage.packageManager = `yarn@${YARN_VERSION}`
  consumerPackage.dependencies["@mantajs/medusa-dashboard"] = `file:${tarball}`
  consumerPackage.dependencies["@medusajs/dashboard"] = "2.16.0"
  consumerPackage.devDependencies = {
    "@types/node": rootPackage.devDependencies["@types/node"],
    "@types/react": rootPackage.devDependencies["@types/react"],
    typescript: rootPackage.devDependencies.typescript,
    vite: rootPackage.peerDependencies.vite,
  }
  consumerPackage.resolutions = {
    "@medusajs/dashboard": `file:${tarball}`,
  }
  writeFileSync(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify(consumerPackage, null, 2)}\n`
  )

  execFileSync("corepack", ["yarn", "install"], {
    cwd: consumerDirectory,
    stdio: "inherit",
    env: childEnvironment,
  })

  const canonicalPackage = JSON.parse(
    readFileSync(
      join(
        consumerDirectory,
        "node_modules/@mantajs/medusa-dashboard/package.json"
      ),
      "utf8"
    )
  )
  const aliasedPackage = JSON.parse(
    readFileSync(
      join(consumerDirectory, "node_modules/@medusajs/dashboard/package.json"),
      "utf8"
    )
  )
  assert.equal(canonicalPackage.name, "@mantajs/medusa-dashboard")
  assert.equal(aliasedPackage.name, "@mantajs/medusa-dashboard")
  assert.equal(canonicalPackage.version, rootPackage.version)
  assert.equal(aliasedPackage.version, rootPackage.version)

  execFileSync("corepack", ["yarn", "tsc", "--project", "tsconfig.json"], {
    cwd: consumerDirectory,
    stdio: "inherit",
    env: childEnvironment,
  })

  execFileSync("corepack", ["yarn", "node", "./runtime-contract.mjs"], {
    cwd: consumerDirectory,
    stdio: "inherit",
    env: childEnvironment,
  })

  const developmentSummary = JSON.parse(
    execFileSync("corepack", ["yarn", "node", "./development-proof.mjs"], {
      cwd: consumerDirectory,
      encoding: "utf8",
      env: childEnvironment,
    }).trim()
  )
  assert.deepEqual(developmentSummary, {
    accepted: 1,
    applied: 1,
    configured: 1,
    decisions: [
      {
        entry: 0,
        override: "src/admin/components/orders/order-list.tsx",
        status: "applied",
        target: "src/routes/orders/order-list/order-list.tsx",
      },
    ],
    rejected: 0,
    schemaVersion: 1,
    unmatched: 0,
  })

  execFileSync("corepack", ["yarn", "vite", "build"], {
    cwd: consumerDirectory,
    stdio: "inherit",
    env: childEnvironment,
  })
  const productionSummary = JSON.parse(
    readFileSync(join(consumerDirectory, "production-summary.json"), "utf8")
  )
  assert.deepEqual(productionSummary, developmentSummary)

  let staleBuildFailure
  try {
    execFileSync(
      "corepack",
      ["yarn", "vite", "build", "--config", "vite.stale.config.mjs"],
      {
        cwd: consumerDirectory,
        encoding: "utf8",
        env: childEnvironment,
        stdio: "pipe",
      }
    )
  } catch (error) {
    staleBuildFailure = `${error.stdout || ""}\n${error.stderr || ""}`
  }
  assert.match(
    staleBuildFailure || "",
    /missing target: src\/routes\/orders\/order-list\/missing\.tsx/,
    "stale exact targets must fail the packed consumer build"
  )
  assert.equal(
    existsSync(join(consumerDirectory, "stale-build")),
    false,
    "stale policy must fail before build output is emitted"
  )

  const emittedFiles = listFiles(join(consumerDirectory, "build"))
  const emittedSource = emittedFiles
    .filter((file) => statSync(file).isFile() && /\.(?:js|css|html)$/.test(file))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
  assert.doesNotMatch(
    emittedSource,
    /node_modules\/(?:@mantajs\/medusa-dashboard|@medusajs\/dashboard)\/(?:src|dist)\//,
    "production output leaked a private package path"
  )

  console.log(
    `${canonicalPackage.name}@${canonicalPackage.version} passed packed canonical + @medusajs/dashboard alias contracts`
  )
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}

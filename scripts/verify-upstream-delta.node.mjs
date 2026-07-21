import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  verifyDeclaredDelta,
  verifyTarballIntegrity,
  validateTarballArchive,
} from "./verify-upstream-delta.mjs"
import { createSyncReview } from "./sync-upstream-dashboard.mjs"

const createTree = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-upstream-test-"))
  const baselineRoot = path.join(root, "baseline")
  const forkRoot = path.join(root, "fork")
  const upstreamRoot = path.join(root, "upstream")
  for (const directory of [baselineRoot, forkRoot, upstreamRoot]) {
    fs.mkdirSync(path.join(directory, "src"), { recursive: true })
    fs.mkdirSync(path.join(directory, "tests"), { recursive: true })
    fs.writeFileSync(path.join(directory, "tests/proof.test.ts"), "proof\n")
  }
  return { baselineRoot, forkRoot, root, upstreamRoot }
}

const write = (root, relativePath, content) => {
  const destination = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, content)
}

const manifest = (entries) => ({
  schemaVersion: 1,
  baseline: { package: "@medusajs/dashboard", version: "2.16.0" },
  entries,
})

const entry = (pathName, kind = "modified") => ({
  path: pathName,
  kind,
  surface: "test",
  rationale: "Synthetic fork behavior",
  evidence: ["tests/proof.test.ts"],
})

test("rejects undeclared drift and accepts the exact declared path", () => {
  const tree = createTree()
  write(tree.baselineRoot, "src/component.tsx", "official\n")
  write(tree.forkRoot, "src/component.tsx", "fork\n")

  const undeclared = verifyDeclaredDelta({
    baselineRoot: tree.baselineRoot,
    forkRoot: tree.forkRoot,
    manifest: manifest([]),
  })
  assert.equal(undeclared.ok, false)
  assert.match(undeclared.errors.join("\n"), /undeclared drift.*src\/component\.tsx/)

  const declared = verifyDeclaredDelta({
    baselineRoot: tree.baselineRoot,
    forkRoot: tree.forkRoot,
    manifest: manifest([entry("src/component.tsx")]),
  })
  assert.equal(declared.ok, true)
})

test("rejects a stale declaration and catch-all path", () => {
  const tree = createTree()
  write(tree.baselineRoot, "src/component.tsx", "same\n")
  write(tree.forkRoot, "src/component.tsx", "same\n")

  const result = verifyDeclaredDelta({
    baselineRoot: tree.baselineRoot,
    forkRoot: tree.forkRoot,
    manifest: manifest([
      entry("src/component.tsx"),
      entry("src/**", "added"),
    ]),
  })

  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /stale declaration.*src\/component\.tsx/)
  assert.match(result.errors.join("\n"), /catch-all.*src\/\*\*/)
})

test("rejects traversal paths and unsupported delta kinds", () => {
  const tree = createTree()
  write(tree.baselineRoot, "src/component.tsx", "official\n")
  write(tree.forkRoot, "src/component.tsx", "fork\n")

  const result = verifyDeclaredDelta({
    baselineRoot: tree.baselineRoot,
    forkRoot: tree.forkRoot,
    manifest: manifest([
      entry("src/../outside.ts"),
      entry("src/component.tsx", "renamed"),
    ]),
  })

  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /exact repo-relative src file/)
  assert.match(result.errors.join("\n"), /invalid delta kind/)
})

test("rejects wrong tarball integrity", () => {
  const bytes = Buffer.from("official tarball")
  const correct = `sha512-${createHash("sha512").update(bytes).digest("base64")}`

  assert.doesNotThrow(() => verifyTarballIntegrity(bytes, correct))
  assert.throws(
    () => verifyTarballIntegrity(bytes, "sha512-AAAAAAAA"),
    /integrity mismatch/
  )
})

test("rejects tarball traversal entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-tar-test-"))
  const source = path.join(root, "source")
  const archive = path.join(root, "traversal.tgz")
  fs.mkdirSync(source)
  write(source, "payload", "unsafe\n")
  execFileSync("tar", [
    "-czf",
    archive,
    "-C",
    source,
    "--transform=s|payload|../escape|",
    "payload",
  ])

  assert.throws(() => validateTarballArchive(archive), /unsafe tarball path/)
  assert.equal(fs.existsSync(path.join(root, "escape")), false)
})

test("rejects tarball symbolic links", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-tar-test-"))
  const source = path.join(root, "source")
  const archive = path.join(root, "symlink.tgz")
  fs.mkdirSync(path.join(source, "package"), { recursive: true })
  fs.symlinkSync("../../outside", path.join(source, "package/link"))
  execFileSync("tar", ["-czf", archive, "-C", source, "package"])

  assert.throws(() => validateTarballArchive(archive), /unsafe tarball entry type l/)
})

test("source contracts match their runtime and public-type boundaries", () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "..")
  const readSource = (relativePath) =>
    fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8")

  const orderSummary = readSource(
    "src/routes/orders/order-detail/components/order-summary-section/order-summary-section.tsx"
  )
  assert.match(orderSummary, /AdminReservation,[\s\S]*from "@medusajs\/types"/)
  assert.doesNotMatch(orderSummary, /@medusajs\/types\/src\//)

  const environmentTypes = readSource("src/vite-env.d.ts")
  const viteConfig = readSource("vite.config.mts")
  for (const variable of [
    "VITE_MEDUSA_BACKEND_URL",
    "VITE_MEDUSA_STOREFRONT_URL",
    "VITE_MEDUSA_BASE",
    "VITE_MEDUSA_PROJECT",
  ]) {
    assert.match(environmentTypes, new RegExp(variable))
    assert.match(viteConfig, new RegExp(variable))
  }

  const virtualTypes = readSource("src/types/virtual-dashboard.d.ts")
  assert.match(virtualTypes, /declare module "virtual:dashboard\/menu-config"/)
  assert.match(virtualTypes, /import type \{ MenuConfig \}/)
  assert.match(virtualTypes, /const config: MenuConfig \| null/)

  const mainLayout = readSource(
    "src/components/layout/main-layout/main-layout.tsx"
  )
  assert.match(mainLayout, /import menuConfig from "virtual:dashboard\/menu-config"/)
  assert.match(mainLayout, /item\.useTranslation \? translate\(item\.label\)/)
  assert.match(
    mainLayout,
    /!route\.items\?\.some\(\(existing\) => existing\.to === item\.to\)/
  )
  assert.match(mainLayout, /!MAIN_MENU_PATHS\.includes\(item\.to\)/)

  const routeMap = readSource("src/dashboard-app/routes/get-route.map.tsx")
  assert.equal((routeMap.match(/children: mergeExtensionRoutes\(/g) ?? []).length, 2)
  assert.match(routeMap, /\], coreRoutes\)/)
  assert.match(routeMap, /\], settingsRoutes\.flatMap/)

  const russian = readSource("src/i18n/translations/ru.json")
  const salesChannelsStart = russian.indexOf('\n  "salesChannels": {')
  const salesChannelsEnd = russian.indexOf(
    '\n  "apiKeyManagement": {',
    salesChannelsStart
  )
  const salesChannels = russian.slice(salesChannelsStart, salesChannelsEnd)
  assert.equal((salesChannels.match(/\n    "tooltip":/g) ?? []).length, 1)

  const dashboardCss = readSource("src/index.css")
  assert.match(dashboardCss, /\.workflow-grid\s*\{/)
  assert.match(dashboardCss, /background-repeat:\s*repeat;/)
  assert.doesNotMatch(dashboardCss, /\.worfklow-grid/)
  assert.doesNotMatch(dashboardCss, /background:\s*repeat;/)
})

test("sync review reapplies clean deltas without modifying the fork", () => {
  const tree = createTree()
  write(tree.baselineRoot, "src/component.tsx", "official\n")
  write(tree.forkRoot, "src/component.tsx", "fork\n")
  write(tree.upstreamRoot, "src/component.tsx", "official\n")
  const before = fs.readFileSync(path.join(tree.forkRoot, "src/component.tsx"), "utf8")
  const outputRoot = path.join(tree.root, "review")

  const report = createSyncReview({
    baselineRoot: tree.baselineRoot,
    deltaManifest: manifest([entry("src/component.tsx")]),
    forkRoot: tree.forkRoot,
    outputRoot,
    upstreamRoot: tree.upstreamRoot,
  })

  assert.equal(report.conflicts.length, 0)
  assert.equal(
    fs.readFileSync(path.join(outputRoot, "candidate/src/component.tsx"), "utf8"),
    "fork\n"
  )
  assert.equal(
    fs.readFileSync(path.join(tree.forkRoot, "src/component.tsx"), "utf8"),
    before
  )
  assert.equal(fs.existsSync(path.join(outputRoot, "review.json")), true)
  assert.equal(fs.existsSync(path.join(outputRoot, "candidate-vs-fork.diff")), true)
})

test("sync review refuses to write inside the fork", () => {
  const tree = createTree()
  write(tree.baselineRoot, "src/component.tsx", "official\n")
  write(tree.forkRoot, "src/component.tsx", "fork\n")
  write(tree.upstreamRoot, "src/component.tsx", "official\n")

  assert.throws(
    () =>
      createSyncReview({
        baselineRoot: tree.baselineRoot,
        deltaManifest: manifest([entry("src/component.tsx")]),
        forkRoot: tree.forkRoot,
        outputRoot: path.join(tree.forkRoot, "review"),
        upstreamRoot: tree.upstreamRoot,
      }),
    /outside the fork root/
  )
})

test("sync review refuses an external parent symlinked into the fork", () => {
  const tree = createTree()
  write(tree.baselineRoot, "src/component.tsx", "official\n")
  write(tree.forkRoot, "src/component.tsx", "fork\n")
  write(tree.upstreamRoot, "src/component.tsx", "official\n")
  const externalLink = path.join(tree.root, "external-review-parent")
  fs.symlinkSync(tree.forkRoot, externalLink, "dir")
  const outputRoot = path.join(externalLink, "review")

  assert.throws(
    () =>
      createSyncReview({
        baselineRoot: tree.baselineRoot,
        deltaManifest: manifest([entry("src/component.tsx")]),
        forkRoot: tree.forkRoot,
        outputRoot,
        upstreamRoot: tree.upstreamRoot,
      }),
    /outside the fork root/
  )
  assert.equal(fs.existsSync(path.join(tree.forkRoot, "review")), false)
})

test("sync review preserves new upstream content and exposes conflicts", () => {
  const tree = createTree()
  write(tree.baselineRoot, "src/component.tsx", "official\n")
  write(tree.forkRoot, "src/component.tsx", "fork\n")
  write(tree.upstreamRoot, "src/component.tsx", "new upstream\n")
  const outputRoot = path.join(tree.root, "review")

  const report = createSyncReview({
    baselineRoot: tree.baselineRoot,
    deltaManifest: manifest([entry("src/component.tsx")]),
    forkRoot: tree.forkRoot,
    outputRoot,
    upstreamRoot: tree.upstreamRoot,
  })

  assert.deepEqual(report.conflicts, ["src/component.tsx"])
  assert.equal(
    fs.readFileSync(path.join(outputRoot, "candidate/src/component.tsx"), "utf8"),
    "new upstream\n"
  )
  assert.equal(
    fs.readFileSync(
      path.join(outputRoot, "conflicts/src/component.tsx.fork"),
      "utf8"
    ),
    "fork\n"
  )
  assert.equal(
    fs.readFileSync(
      path.join(outputRoot, "conflicts/src/component.tsx.upstream"),
      "utf8"
    ),
    "new upstream\n"
  )
})

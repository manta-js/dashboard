import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const root = path.resolve(import.meta.dirname, "..")

export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"))

const listFiles = (rootDirectory, relativeDirectory = "") => {
  const directory = path.join(rootDirectory, relativeDirectory)
  if (!fs.existsSync(directory)) return []

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const relativePath = path.posix.join(relativeDirectory, entry.name)
      if (entry.isDirectory()) return listFiles(rootDirectory, relativePath)
      if (!entry.isFile()) {
        throw new Error(`unsupported upstream tree entry: ${relativePath}`)
      }
      return [relativePath]
    })
}

const fileDigest = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex")

const collectTree = (treeRoot) =>
  new Map(
    listFiles(treeRoot, "src").map((relativePath) => [
      relativePath,
      fileDigest(path.join(treeRoot, relativePath)),
    ])
  )

const actualChanges = (baselineRoot, forkRoot) => {
  const baseline = collectTree(baselineRoot)
  const fork = collectTree(forkRoot)
  const paths = [...new Set([...baseline.keys(), ...fork.keys()])].sort()

  return new Map(
    paths.flatMap((relativePath) => {
      const baselineDigest = baseline.get(relativePath)
      const forkDigest = fork.get(relativePath)
      if (baselineDigest === forkDigest) return []
      const kind = baselineDigest === undefined
        ? "added"
        : forkDigest === undefined
          ? "deleted"
          : "modified"
      return [[relativePath, kind]]
    })
  )
}

const hasCatchAll = (declaredPath) => /[*?\[\]{}]/.test(declaredPath)

export const verifyDeclaredDelta = ({ baselineRoot, forkRoot, manifest }) => {
  const errors = []
  const declared = new Map()

  if (manifest.schemaVersion !== 1) {
    errors.push(`unsupported fork delta schema: ${manifest.schemaVersion}`)
  }

  for (const entry of manifest.entries ?? []) {
    const declaredPath = entry.path
    if (
      typeof declaredPath !== "string" ||
      !declaredPath.startsWith("src/") ||
      path.isAbsolute(declaredPath) ||
      path.posix.normalize(declaredPath) !== declaredPath ||
      declaredPath.endsWith("/")
    ) {
      errors.push(`delta path must be an exact repo-relative src file: ${declaredPath}`)
      continue
    }
    if (hasCatchAll(declaredPath)) {
      errors.push(`catch-all delta paths are forbidden: ${declaredPath}`)
      continue
    }
    if (declared.has(declaredPath)) {
      errors.push(`duplicate delta declaration: ${declaredPath}`)
      continue
    }
    if (!["added", "modified", "deleted"].includes(entry.kind)) {
      errors.push(`invalid delta kind for ${declaredPath}: ${entry.kind}`)
    }
    if (!entry.surface || !entry.rationale) {
      errors.push(`delta declaration lacks surface/rationale: ${declaredPath}`)
    }
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      errors.push(`delta declaration lacks evidence: ${declaredPath}`)
    } else {
      for (const evidence of entry.evidence) {
        const validEvidence =
          typeof evidence === "string" &&
          evidence.length > 0 &&
          !path.isAbsolute(evidence) &&
          path.posix.normalize(evidence) === evidence &&
          !evidence.startsWith("../")
        if (!validEvidence || !fs.existsSync(path.join(forkRoot, evidence))) {
          errors.push(`delta evidence does not exist: ${declaredPath} -> ${evidence}`)
        }
      }
    }
    declared.set(declaredPath, entry)
  }

  const changes = actualChanges(baselineRoot, forkRoot)
  for (const [changedPath, kind] of changes) {
    const declaration = declared.get(changedPath)
    if (!declaration) {
      errors.push(`undeclared drift (${kind}): ${changedPath}`)
    } else if (declaration.kind !== kind) {
      errors.push(
        `delta kind mismatch for ${changedPath}: declared ${declaration.kind}, actual ${kind}`
      )
    }
  }
  for (const declaredPath of declared.keys()) {
    if (!changes.has(declaredPath)) {
      errors.push(`stale declaration (no delta): ${declaredPath}`)
    }
  }

  return {
    ok: errors.length === 0,
    changes: [...changes].map(([changedPath, kind]) => ({
      path: changedPath,
      kind,
    })),
    errors,
  }
}

export const verifyTarballIntegrity = (bytes, expectedIntegrity) => {
  const separator = expectedIntegrity.indexOf("-")
  if (separator <= 0) throw new Error("invalid baseline integrity format")
  const algorithm = expectedIntegrity.slice(0, separator)
  const expected = expectedIntegrity.slice(separator + 1)
  const actual = createHash(algorithm).update(bytes).digest("base64")
  if (actual !== expected) {
    throw new Error(
      `integrity mismatch: expected ${algorithm}-${expected}, received ${algorithm}-${actual}`
    )
  }
}

const listTarEntries = (archive, verbose = false) => {
  const args = [
    verbose ? "-tvzf" : "-tzf",
    archive,
    "--quoting-style=c",
  ]
  const output = execFileSync("tar", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
  return output === "" ? [] : output.trimEnd().split("\n")
}

export const validateTarballArchive = (archive) => {
  const entries = listTarEntries(archive).map((listedEntry) => {
    if (!listedEntry.startsWith('"')) return listedEntry
    try {
      return JSON.parse(listedEntry)
    } catch {
      throw new Error(`unsafe tarball path encoding: ${listedEntry}`)
    }
  })
  const verboseEntries = listTarEntries(archive, true)
  if (entries.length === 0 || entries.length !== verboseEntries.length) {
    throw new Error("unsafe tarball: invalid or empty archive listing")
  }

  const seen = new Set()
  entries.forEach((entry, index) => {
    if (
      entry.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(entry) ||
      path.posix.isAbsolute(entry)
    ) {
      throw new Error(`unsafe tarball path: ${entry}`)
    }
    const segments = entry.split("/").filter(Boolean)
    if (
      segments[0] !== "package" ||
      segments.some((segment) => segment === "." || segment === "..")
    ) {
      throw new Error(`unsafe tarball path: ${entry}`)
    }
    if (seen.has(entry)) {
      throw new Error(`unsafe tarball duplicate entry: ${entry}`)
    }
    seen.add(entry)

    const type = verboseEntries[index][0]
    if (type !== "-" && type !== "d") {
      throw new Error(`unsafe tarball entry type ${type}: ${entry}`)
    }
  })
}

export const materializeTarball = async (
  { tarball, integrity, shasum },
  destination
) => {
  const response = await fetch(tarball)
  if (!response.ok) {
    throw new Error(`unable to download upstream tarball: HTTP ${response.status}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  verifyTarballIntegrity(bytes, integrity)
  if (shasum) {
    const actualShasum = createHash("sha1").update(bytes).digest("hex")
    if (actualShasum !== shasum) {
      throw new Error(
        `shasum mismatch: expected ${shasum}, received ${actualShasum}`
      )
    }
  }
  fs.mkdirSync(destination, { recursive: true })
  const archive = path.join(destination, "upstream.tgz")
  fs.writeFileSync(archive, bytes)
  validateTarballArchive(archive)
  execFileSync("tar", [
    "-xzf",
    archive,
    "-C",
    destination,
    "--no-same-owner",
    "--no-same-permissions",
    "--delay-directory-restore",
  ])
  return path.join(destination, "package")
}

const main = async () => {
  const baseline = readJson(path.join(root, "upstream/dashboard-baseline.json"))
  const manifest = readJson(path.join(root, "upstream/fork-delta.json"))
  if (baseline.sourceRoot !== "package/src") {
    throw new Error("dashboard baseline sourceRoot must be package/src")
  }
  for (const field of [
    "package",
    "version",
    "tarball",
    "integrity",
    "shasum",
    "gitTag",
  ]) {
    if (typeof baseline[field] !== "string" || baseline[field].length === 0) {
      throw new Error(`dashboard baseline lacks ${field}`)
    }
  }
  if (
    manifest.baseline?.package !== baseline.package ||
    manifest.baseline?.version !== baseline.version
  ) {
    throw new Error("fork delta baseline does not match dashboard baseline manifest")
  }

  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "mantajs-dashboard-upstream-")
  )
  try {
    const baselineRoot = await materializeTarball(baseline, temporaryRoot)
    const result = verifyDeclaredDelta({ baselineRoot, forkRoot: root, manifest })
    if (!result.ok) throw new Error(result.errors.join("\n"))
    console.log(
      `Upstream delta verified: ${result.changes.length} exact paths against ${baseline.package}@${baseline.version}`
    )
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true })
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main()
}

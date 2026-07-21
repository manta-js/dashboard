import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import {
  materializeTarball,
  readJson,
  verifyDeclaredDelta,
} from "./verify-upstream-delta.mjs"

const root = path.resolve(import.meta.dirname, "..")

const fileState = (rootDirectory, relativePath) => {
  const file = path.join(rootDirectory, relativePath)
  return fs.existsSync(file) ? fs.readFileSync(file) : null
}

const equalState = (left, right) =>
  left === null || right === null
    ? left === right
    : Buffer.compare(left, right) === 0

const writeState = (rootDirectory, relativePath, state) => {
  const destination = path.join(rootDirectory, relativePath)
  if (state === null) {
    fs.rmSync(destination, { force: true })
    return
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, state)
}

const canonicalizePotentialPath = (targetPath) => {
  let existingAncestor = path.resolve(targetPath)
  const missingSegments = []

  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor)
    if (parent === existingAncestor) {
      throw new Error(`unable to resolve sync review output: ${targetPath}`)
    }
    missingSegments.unshift(path.basename(existingAncestor))
    existingAncestor = parent
  }

  return path.resolve(fs.realpathSync(existingAncestor), ...missingSegments)
}

export const createSyncReview = ({
  baselineRoot,
  deltaManifest,
  forkRoot,
  outputRoot,
  upstreamRoot,
}) => {
  const canonicalForkRoot = fs.realpathSync(forkRoot)
  const canonicalOutputRoot = canonicalizePotentialPath(outputRoot)
  const relativeOutput = path.relative(canonicalForkRoot, canonicalOutputRoot)
  if (
    relativeOutput === "" ||
    (!relativeOutput.startsWith("..") && !path.isAbsolute(relativeOutput))
  ) {
    throw new Error("sync review output must be outside the fork root")
  }
  if (fs.existsSync(outputRoot)) {
    throw new Error(`sync review output already exists: ${outputRoot}`)
  }
  const declaredDelta = verifyDeclaredDelta({
    baselineRoot,
    forkRoot,
    manifest: deltaManifest,
  })
  if (!declaredDelta.ok) {
    throw new Error(
      `refusing sync with invalid fork delta:\n${declaredDelta.errors.join("\n")}`
    )
  }
  const candidateRoot = path.join(outputRoot, "candidate")
  fs.mkdirSync(candidateRoot, { recursive: true })
  fs.cpSync(path.join(upstreamRoot, "src"), path.join(candidateRoot, "src"), {
    recursive: true,
  })

  const conflicts = []
  const applied = []
  const upstreamIntegrated = []

  for (const entry of deltaManifest.entries) {
    const baseline = fileState(baselineRoot, entry.path)
    const fork = fileState(forkRoot, entry.path)
    const upstream = fileState(upstreamRoot, entry.path)

    if (equalState(upstream, baseline)) {
      writeState(candidateRoot, entry.path, fork)
      applied.push(entry.path)
      continue
    }
    if (equalState(upstream, fork)) {
      upstreamIntegrated.push(entry.path)
      continue
    }

    conflicts.push(entry.path)
    const conflictRoot = path.join(outputRoot, "conflicts")
    writeState(conflictRoot, `${entry.path}.fork`, fork)
    writeState(conflictRoot, `${entry.path}.upstream`, upstream)
  }

  const report = {
    schemaVersion: 1,
    applied,
    upstreamIntegrated,
    conflicts,
  }
  fs.writeFileSync(
    path.join(outputRoot, "review.json"),
    `${JSON.stringify(report, null, 2)}\n`
  )
  fs.writeFileSync(
    path.join(outputRoot, "review.md"),
    [
      "# Dashboard upstream sync review",
      "",
      `- Clean fork deltas reapplied: ${applied.length}`,
      `- Already integrated upstream: ${upstreamIntegrated.length}`,
      `- Conflicts requiring review: ${conflicts.length}`,
      "",
      ...conflicts.map((conflict) => `- CONFLICT: \`${conflict}\``),
      "",
    ].join("\n")
  )

  const diff = spawnSync(
    "diff",
    ["-ruN", path.join(candidateRoot, "src"), path.join(forkRoot, "src")],
    { encoding: "utf8" }
  )
  if (diff.status !== 0 && diff.status !== 1) {
    throw new Error(`unable to generate review diff: ${diff.stderr}`)
  }
  fs.writeFileSync(path.join(outputRoot, "candidate-vs-fork.diff"), diff.stdout)
  return report
}

const argument = (name) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const main = async () => {
  const tarball = argument("--tarball")
  const integrity = argument("--integrity")
  const output = argument("--output")
  if (!tarball || !integrity || !output) {
    throw new Error("required: --tarball <url> --integrity <sri> --output <directory>")
  }
  const outputRoot = path.resolve(output)
  const deltaManifest = readJson(path.join(root, "upstream/fork-delta.json"))
  const baseline = readJson(path.join(root, "upstream/dashboard-baseline.json"))
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "mantajs-dashboard-sync-")
  )
  try {
    const baselineRoot = await materializeTarball(
      baseline,
      path.join(temporaryRoot, "baseline")
    )
    const upstreamRoot = await materializeTarball(
      { tarball, integrity },
      path.join(temporaryRoot, "upstream")
    )
    const report = createSyncReview({
      baselineRoot,
      deltaManifest,
      forkRoot: root,
      outputRoot,
      upstreamRoot,
    })
    console.log(
      `Sync review written to ${outputRoot}: ${report.conflicts.length} conflicts`
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

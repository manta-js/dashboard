import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(import.meta.dirname, "..")

const assertRegularTree = (directory) => {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const stat = lstatSync(path)
    assert.ok(
      stat.isDirectory() || stat.isFile(),
      `candidate archive contains an unsupported entry: ${entry}`
    )
    if (stat.isDirectory()) {
      assertRegularTree(path)
    }
  }
}

export const prepareReleaseCandidate = ({
  input,
  output,
  releasePackage,
  transition,
}) => {
  const extractionRoot = mkdtempSync(join(tmpdir(), "dashboard-candidate-"))

  try {
    const entries = execFileSync("tar", ["-tzf", input], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
    assert.ok(
      entries.length > 0 &&
        entries.every(
          (entry) =>
            entry === "package" ||
            (entry.startsWith("package/") &&
              !entry.split("/").includes(".."))
        ),
      "candidate archive must contain only the package tree"
    )

    execFileSync("tar", ["-xzf", input, "-C", extractionRoot])
    assertRegularTree(join(extractionRoot, "package"))
    const candidatePackage = JSON.parse(
      readFileSync(join(extractionRoot, "package/package.json"), "utf8")
    )
    assert.equal(
      candidatePackage.name,
      transition.to.package,
      "candidate archive package identity must match the transition"
    )
    assert.equal(
      candidatePackage.version,
      transition.to.version,
      "candidate archive package version must match the transition"
    )
    assert.deepEqual(
      candidatePackage.publishConfig,
      releasePackage.publishConfig,
      "candidate archive publishConfig must match the authorized release policy"
    )

    execFileSync("tar", [
      "--sort=name",
      "--mtime=UTC 1970-01-01",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--mode=u+rwX,go+rX,go-w",
      "-czf",
      output,
      "-C",
      extractionRoot,
      "package",
    ])
    const actualSha256 = createHash("sha256")
      .update(readFileSync(output))
      .digest("hex")
    assert.equal(
      actualSha256,
      transition.candidate.tarballSha256,
      "normalized candidate archive must match the attested SHA-256"
    )
  } finally {
    rmSync(extractionRoot, { force: true, recursive: true })
  }
}

const run = async () => {
  const [input, output] = process.argv.slice(2)
  assert.ok(input && output, "usage: prepare-release-candidate <input> <output>")
  const transition = JSON.parse(
    await readFile(
      resolve(root, "release/medusa-dashboard-transition.json"),
      "utf8"
    )
  )
  const releasePackage = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8")
  )
  prepareReleaseCandidate({ input, output, releasePackage, transition })
  console.log(`Prepared attested release candidate at ${output}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await run()
}

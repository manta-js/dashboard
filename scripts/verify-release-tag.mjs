import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(import.meta.dirname, "..")

export const verifyRelease = ({
  packageJson,
  transition,
  actualTag,
  targetCommitish,
  isMainAncestor,
}) => {
  assert.equal(
    packageJson.name,
    "@mantajs/medusa-dashboard",
    "release package must use the Medusa-specific npm identity"
  )
  assert.match(
    packageJson.version,
    /^\d+\.\d+\.\d+-medusa\.\d+$/,
    "release version must stay on the isolated Medusa prerelease line"
  )
  assert.equal(
    packageJson.publishConfig?.tag,
    "medusa",
    "release package must publish under the medusa dist-tag"
  )
  assert.equal(
    actualTag,
    `v${packageJson.version}`,
    `release tag ${actualTag || "<missing>"} must match package version v${packageJson.version}`
  )
  assert.equal(
    targetCommitish,
    "main",
    "GitHub Release target_commitish must be main"
  )
  assert.equal(
    isMainAncestor,
    true,
    "release commit must be contained in origin/main"
  )
  assert.equal(transition.schemaVersion, 1)
  assert.equal(transition.to?.package, packageJson.name)
  assert.equal(transition.to?.version, packageJson.version)
  assert.equal(transition.authorization?.owner, "OLI-405")
  assert.equal(
    transition.state,
    "authorized-after-oli-405",
    "release transition is locked until OLI-405 migration is authorized"
  )
  assert.equal(
    transition.authorization?.authorized,
    true,
    "OLI-405 must explicitly authorize the package release"
  )
  assert.match(
    transition.authorization?.evidence?.pullRequest || "",
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/,
    "authorization must record the merged OLI-405 pull request"
  )
  assert.match(
    transition.authorization?.evidence?.mergeCommit || "",
    /^[0-9a-f]{40}$/,
    "authorization must record the OLI-405 merge commit"
  )
}

const run = async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8")
  )
  const transition = JSON.parse(
    await readFile(
      resolve(root, "release/medusa-dashboard-transition.json"),
      "utf8"
    )
  )
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, "utf8")
  )

  let isMainAncestor = false
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", process.env.GITHUB_SHA, "origin/main"],
      { cwd: root, stdio: "ignore" }
    )
    isMainAncestor = true
  } catch {
    isMainAncestor = false
  }

  verifyRelease({
    packageJson,
    transition,
    actualTag: process.env.GITHUB_REF_NAME,
    targetCommitish: event.release?.target_commitish,
    isMainAncestor,
  })

  console.log(
    `Release ${process.env.GITHUB_REF_NAME} is authorized for ${packageJson.name}@${packageJson.version}`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await run()
}

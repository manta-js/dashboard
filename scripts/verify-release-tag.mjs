import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  loadGithubReleaseEvidence,
  REQUIRED_B2B_CHECKS,
} from "./github-release-evidence.mjs"
import {
  AUTHORIZED_AFTER_VALIDATION,
  verifyTransitionAuthorization,
} from "./transition-contract.mjs"

const root = resolve(import.meta.dirname, "..")

export const verifyRelease = ({
  packageJson,
  transition,
  actualTag,
  targetCommitish,
  isMainAncestor,
  githubEvidence,
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
  assert.equal(transition.to?.package, packageJson.name)
  assert.equal(transition.to?.version, packageJson.version)
  verifyTransitionAuthorization(transition)
  assert.equal(
    githubEvidence?.url,
    transition.authorization.evidence.pullRequest,
    "GitHub evidence must match the authorized OLI-405 pull request"
  )
  assert.equal(
    githubEvidence?.baseRef,
    "refactor",
    "OLI-405 must target the B2B refactor branch"
  )
  assert.ok(
    githubEvidence?.checks?.length > 0 &&
      githubEvidence.checks.every(
        (check) =>
          check.status === "completed" &&
          ["success", "neutral", "skipped"].includes(check.conclusion)
      ),
    "all OLI-405 checks must be green"
  )
  const completedChecks = new Set(
    githubEvidence.checks.map(({ name }) => name)
  )
  assert.ok(
    REQUIRED_B2B_CHECKS.every((name) => completedChecks.has(name)),
    "OLI-405 must pass every required B2B CI job"
  )

  if (transition.state === AUTHORIZED_AFTER_VALIDATION) {
    assert.equal(githubEvidence?.state, "open")
    assert.equal(githubEvidence?.merged, false)
    assert.equal(
      githubEvidence?.headCommit,
      transition.authorization.evidence.headCommit,
      "GitHub must still expose the exact validated OLI-405 head commit"
    )
  } else {
    assert.equal(githubEvidence?.state, "closed")
    assert.equal(githubEvidence?.merged, true)
    assert.equal(
      githubEvidence?.mergeCommit,
      transition.authorization.evidence.mergeCommit,
      "GitHub must expose the authorized OLI-405 merge commit"
    )
  }
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
  const githubEvidence = loadGithubReleaseEvidence(transition)

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
    githubEvidence,
  })

  console.log(
    `Release ${process.env.GITHUB_REF_NAME} is authorized for ${packageJson.name}@${packageJson.version}`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await run()
}

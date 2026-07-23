import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { appendFile, readFile } from "node:fs/promises"
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
  candidatePackageJson,
  transition,
  actualTag,
  targetCommitish,
  isMainAncestor,
  isCandidateReleaseAncestor,
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
    `medusa-dashboard-v${packageJson.version}`,
    `release tag ${actualTag || "<missing>"} must use the Medusa Dashboard namespace medusa-dashboard-v${packageJson.version}`
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
    candidatePackageJson?.name,
    packageJson.name,
    "candidate package identity must match the authorized release identity"
  )
  assert.equal(
    candidatePackageJson?.version,
    packageJson.version,
    "candidate package version must match the authorized release version"
  )
  assert.deepEqual(
    candidatePackageJson?.publishConfig,
    packageJson.publishConfig,
    "candidate publishConfig must match the authorized release policy"
  )
  assert.equal(
    isCandidateReleaseAncestor,
    true,
    "attested candidate commit must be an ancestor of the release commit"
  )
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
  const requiredChecks = githubEvidence.checks.filter(({ name }) =>
    REQUIRED_B2B_CHECKS.includes(name)
  )
  assert.ok(
    requiredChecks.every(
      ({
        appSlug,
        source,
        status,
        conclusion,
        workflowEvent,
        workflowHeadCommit,
        workflowPath,
        workflowRepository,
        workflowRunId,
      }) =>
        source === "check-run" &&
        appSlug === "github-actions" &&
        status === "completed" &&
        conclusion === "success" &&
        workflowEvent === "pull_request" &&
        workflowHeadCommit === githubEvidence.headCommit &&
        workflowPath === ".github/workflows/build.yml" &&
        workflowRepository === "OlivierBelaud/palas-wholesale" &&
        /^\d+$/.test(workflowRunId || "")
    ),
    "every required B2B CI job must come from the expected successful GitHub Actions workflow run"
  )
  assert.equal(
    new Set(requiredChecks.map(({ workflowRunId }) => workflowRunId)).size,
    1,
    "all required B2B CI jobs must come from the same GitHub Actions workflow run"
  )
  const completedChecks = new Set(
    requiredChecks.map(({ name }) => name)
  )
  assert.ok(
    REQUIRED_B2B_CHECKS.every((name) => completedChecks.has(name)),
    "OLI-405 must pass every required B2B CI job with conclusion success"
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
  const candidatePackageJson = JSON.parse(
    execFileSync(
      "git",
      ["show", `${transition.candidate.commit}:package.json`],
      { cwd: root, encoding: "utf8" }
    )
  )
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, "utf8")
  )
  const githubEvidence = loadGithubReleaseEvidence(transition)

  let isMainAncestor = false
  let isCandidateReleaseAncestor = false
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
  try {
    execFileSync(
      "git",
      [
        "merge-base",
        "--is-ancestor",
        transition.candidate.commit,
        process.env.GITHUB_SHA,
      ],
      { cwd: root, stdio: "ignore" }
    )
    isCandidateReleaseAncestor = true
  } catch {
    isCandidateReleaseAncestor = false
  }

  verifyRelease({
    packageJson,
    candidatePackageJson,
    transition,
    actualTag: process.env.GITHUB_REF_NAME,
    targetCommitish: event.release?.target_commitish,
    isMainAncestor,
    isCandidateReleaseAncestor,
    githubEvidence,
  })

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      [
        `candidate_commit=${transition.candidate.commit}`,
        `candidate_tarball_sha256=${transition.candidate.tarballSha256}`,
        "",
      ].join("\n")
    )
  }

  console.log(
    `Release ${process.env.GITHUB_REF_NAME} is authorized for ${packageJson.name}@${packageJson.version}`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await run()
}

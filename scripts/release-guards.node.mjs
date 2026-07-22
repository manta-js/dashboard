import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { resolve } from "node:path"
import { verifyRelease } from "./verify-release-tag.mjs"
import {
  loadGithubReleaseEvidence,
  REQUIRED_B2B_CHECKS,
} from "./github-release-evidence.mjs"
import { verifyTransitionAuthorization } from "./transition-contract.mjs"

const root = resolve(import.meta.dirname, "..")

const readJson = async (path) =>
  JSON.parse(await readFile(resolve(root, path), "utf8"))

test("candidate uses the unambiguous Medusa dashboard identity", async () => {
  const packageJson = await readJson("package.json")

  assert.equal(packageJson.name, "@mantajs/medusa-dashboard")
  assert.equal(packageJson.publishConfig?.tag, "medusa")
  assert.match(packageJson.version, /^\d+\.\d+\.\d+-medusa\.\d+$/)
})

test("transition records the staged OLI-405 validation contract", async () => {
  const transition = await readJson("release/medusa-dashboard-transition.json")

  assert.equal(transition.from.package, "@mantajs/dashboard")
  assert.equal(transition.from.version, "0.1.18-medusa.0")
  assert.equal(transition.to.package, "@mantajs/medusa-dashboard")
  assert.equal(transition.to.version, "0.1.18-medusa.0")
  assert.doesNotThrow(() =>
    verifyTransitionAuthorization(transition, { allowAwaiting: true })
  )
})

test("publish workflow cannot run on push or pull request", async () => {
  const workflow = await readFile(
    resolve(root, ".github/workflows/publish.yml"),
    "utf8"
  )

  assert.match(workflow, /\bon:\s*\n\s+release:\s*\n\s+types:\s*\[published\]/)
  assert.doesNotMatch(workflow, /^\s*(push|pull_request|workflow_dispatch):/m)
  assert.match(workflow, /verify-release-tag\.mjs/)
  assert.match(workflow, /environment: npm-medusa-dashboard/)
  assert.match(workflow, /npm publish --tag medusa --provenance --access public/)
  assert.doesNotMatch(workflow, /npm\s+deprecate/)
})

test("migration documentation preserves rollback and deferred ownership", async () => {
  const documentation = await readFile(
    resolve(root, "docs/PACKAGE_MIGRATION.md"),
    "utf8"
  )

  assert.match(documentation, /@mantajs\/dashboard@0\.1\.18-medusa\.0/)
  assert.match(documentation, /@mantajs\/medusa-dashboard/)
  assert.match(documentation, /OLI-405/)
  assert.match(documentation, /does not publish/)
  assert.match(documentation, /Never deprecate[\s\S]*generic `0\.2\.x`/)
})

const candidatePackage = {
  name: "@mantajs/medusa-dashboard",
  version: "0.1.18-medusa.0",
  publishConfig: { tag: "medusa" },
}
const lockedTransition = {
  schemaVersion: 2,
  to: {
    package: "@mantajs/medusa-dashboard",
    version: "0.1.18-medusa.0",
  },
  state: "awaiting-oli-405",
  authorization: { authorized: false, owner: "OLI-405", evidence: null },
}
const authorizedTransition = {
  ...lockedTransition,
  state: "authorized-after-oli-405-validation",
  authorization: {
    authorized: true,
    owner: "OLI-405",
    evidence: {
      type: "validated-pr-head",
      pullRequest: "https://github.com/OlivierBelaud/palas-wholesale/pull/405",
      headCommit: "a".repeat(40),
    },
  },
}
const validRelease = {
  packageJson: candidatePackage,
  transition: authorizedTransition,
  actualTag: "v0.1.18-medusa.0",
  targetCommitish: "main",
  isMainAncestor: true,
  githubEvidence: {
    baseRef: "refactor",
    checks: REQUIRED_B2B_CHECKS.map((name) => ({
      name,
      status: "completed",
      conclusion: "success",
    })),
    headCommit: "a".repeat(40),
    mergeCommit: null,
    merged: false,
    number: 405,
    state: "open",
    url: "https://github.com/OlivierBelaud/palas-wholesale/pull/405",
  },
}

test("release guard rejects ambiguous identity and generic versions", () => {
  assert.throws(
    () =>
      verifyRelease({
        ...validRelease,
        packageJson: { ...candidatePackage, name: "@mantajs/dashboard" },
      }),
    /Medusa-specific npm identity/
  )
  assert.throws(
    () =>
      verifyRelease({
        ...validRelease,
        packageJson: { ...candidatePackage, version: "0.2.0" },
      }),
    /isolated Medusa prerelease line/
  )
})

test("release guard rejects tags and commits outside main", () => {
  assert.throws(
    () => verifyRelease({ ...validRelease, actualTag: "v0.1.18" }),
    /must match package version/
  )
  assert.throws(
    () => verifyRelease({ ...validRelease, targetCommitish: "feature" }),
    /target_commitish must be main/
  )
  assert.throws(
    () => verifyRelease({ ...validRelease, isMainAncestor: false }),
    /contained in origin\/main/
  )
})

test("release guard rejects locked transition and incomplete OLI-405 evidence", () => {
  assert.throws(
    () => verifyRelease({ ...validRelease, transition: lockedTransition }),
    /locked until OLI-405/
  )
  assert.throws(
    () =>
      verifyRelease({
        ...validRelease,
        transition: {
          ...authorizedTransition,
          authorization: {
            ...authorizedTransition.authorization,
            evidence: null,
          },
        },
      }),
    /validated OLI-405 pull request/
  )
})

test("release guard accepts an explicitly authorized validated OLI-405 head", () => {
  assert.doesNotThrow(() => verifyRelease(validRelease))
})

test("release guard rejects a moved OLI-405 head or non-green checks", () => {
  assert.throws(
    () =>
      verifyRelease({
        ...validRelease,
        githubEvidence: {
          ...validRelease.githubEvidence,
          headCommit: "c".repeat(40),
        },
      }),
    /validated OLI-405 head commit/
  )
  assert.throws(
    () =>
      verifyRelease({
        ...validRelease,
        githubEvidence: {
          ...validRelease.githubEvidence,
          checks: REQUIRED_B2B_CHECKS.map((name, index) => ({
            name,
            status: "completed",
            conclusion: index === 0 ? "failure" : "success",
          })),
        },
      }),
    /all OLI-405 checks must be green/
  )
})

test("release guard also accepts post-merge OLI-405 evidence", () => {
  assert.doesNotThrow(() =>
    verifyRelease({
      ...validRelease,
      transition: {
        ...authorizedTransition,
        state: "authorized-after-oli-405",
        authorization: {
          ...authorizedTransition.authorization,
          evidence: {
            type: "merged-pr",
            pullRequest: "https://github.com/OlivierBelaud/palas-wholesale/pull/405",
            mergeCommit: "b".repeat(40),
          },
        },
      },
      githubEvidence: {
        ...validRelease.githubEvidence,
        headCommit: "c".repeat(40),
        mergeCommit: "b".repeat(40),
        merged: true,
        state: "closed",
      },
    })
  )
})

test("GitHub evidence loader binds the private B2B PR and its head checks", () => {
  const requests = []
  const request = (endpoint, token) => {
    requests.push([endpoint, token])
    if (endpoint.endsWith("/pulls/405")) {
      return {
        base: { ref: "refactor" },
        head: { sha: "a".repeat(40) },
        html_url:
          "https://github.com/OlivierBelaud/palas-wholesale/pull/405",
        merge_commit_sha: null,
        merged: false,
        number: 405,
        state: "open",
      }
    }
    if (endpoint.includes("/check-runs")) {
      return {
        check_runs: REQUIRED_B2B_CHECKS.map((name) => ({
          conclusion: "success",
          name,
          status: "completed",
        })),
      }
    }
    return { statuses: [] }
  }

  assert.deepEqual(
    loadGithubReleaseEvidence(authorizedTransition, {
      request,
      token: "test-token",
    }),
    validRelease.githubEvidence
  )
  assert.equal(requests.length, 3)
  assert.ok(requests.every(([, token]) => token === "test-token"))
})

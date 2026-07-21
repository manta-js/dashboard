import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { resolve } from "node:path"
import { verifyRelease } from "./verify-release-tag.mjs"

const root = resolve(import.meta.dirname, "..")

const readJson = async (path) =>
  JSON.parse(await readFile(resolve(root, path), "utf8"))

test("candidate uses the unambiguous Medusa dashboard identity", async () => {
  const packageJson = await readJson("package.json")

  assert.equal(packageJson.name, "@mantajs/medusa-dashboard")
  assert.equal(packageJson.publishConfig?.tag, "medusa")
  assert.match(packageJson.version, /^\d+\.\d+\.\d+-medusa\.\d+$/)
})

test("transition records the staged OLI-405 authorization contract", async () => {
  const transition = await readJson("release/medusa-dashboard-transition.json")

  assert.equal(transition.schemaVersion, 1)
  assert.equal(transition.from.package, "@mantajs/dashboard")
  assert.equal(transition.from.version, "0.1.18-medusa.0")
  assert.equal(transition.to.package, "@mantajs/medusa-dashboard")
  assert.equal(transition.to.version, "0.1.18-medusa.0")
  assert.equal(transition.authorization.owner, "OLI-405")
  assert.ok(
    ["awaiting-oli-405", "authorized-after-oli-405"].includes(
      transition.state
    )
  )
  if (transition.state === "awaiting-oli-405") {
    assert.equal(transition.authorization.authorized, false)
    assert.equal(transition.authorization.evidence, null)
  } else {
    assert.equal(transition.authorization.authorized, true)
    assert.match(
      transition.authorization.evidence?.pullRequest || "",
      /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/
    )
    assert.match(
      transition.authorization.evidence?.mergeCommit || "",
      /^[0-9a-f]{40}$/
    )
  }
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
  schemaVersion: 1,
  to: {
    package: "@mantajs/medusa-dashboard",
    version: "0.1.18-medusa.0",
  },
  state: "awaiting-oli-405",
  authorization: { authorized: false, owner: "OLI-405", evidence: null },
}
const authorizedTransition = {
  ...lockedTransition,
  state: "authorized-after-oli-405",
  authorization: {
    authorized: true,
    owner: "OLI-405",
    evidence: {
      pullRequest: "https://github.com/example/b2b/pull/405",
      mergeCommit: "a".repeat(40),
    },
  },
}
const validRelease = {
  packageJson: candidatePackage,
  transition: authorizedTransition,
  actualTag: "v0.1.18-medusa.0",
  targetCommitish: "main",
  isMainAncestor: true,
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

test("release guard rejects locked transition and missing OLI-405 evidence", () => {
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
    /merged OLI-405 pull request/
  )
})

test("release guard accepts only an authorized Medusa-specific release", () => {
  assert.doesNotThrow(() => verifyRelease(validRelease))
})

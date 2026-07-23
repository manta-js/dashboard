import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises"
import test from "node:test"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { verifyRelease } from "./verify-release-tag.mjs"
import {
  loadGithubReleaseEvidence,
  REQUIRED_B2B_CHECKS,
} from "./github-release-evidence.mjs"
import { verifyTransitionAuthorization } from "./transition-contract.mjs"
import { prepareReleaseCandidate } from "./prepare-release-candidate.mjs"

const root = resolve(import.meta.dirname, "..")

const readJson = async (path) =>
  JSON.parse(await readFile(resolve(root, path), "utf8"))

test("candidate uses the unambiguous Medusa dashboard identity", async () => {
  const packageJson = await readJson("package.json")

  assert.equal(packageJson.name, "@mantajs/medusa-dashboard")
  assert.equal(packageJson.publishConfig?.tag, "medusa")
  assert.match(packageJson.version, /^\d+\.\d+\.\d+-medusa\.\d+$/)
})

test("transition records the authorized immutable OLI-405 validation", async () => {
  const transition = await readJson("release/medusa-dashboard-transition.json")

  assert.equal(transition.from.package, "@mantajs/dashboard")
  assert.equal(transition.from.version, "0.1.18-medusa.0")
  assert.equal(transition.to.package, "@mantajs/medusa-dashboard")
  assert.equal(transition.to.version, "0.1.18-medusa.0")
  assert.equal(
    transition.candidate.commit,
    "8723df1c922e98b1fe74a28f38edee4d47a20b23"
  )
  assert.equal(
    transition.candidate.tarballSha256,
    "0ecca5c6c4908c6577299153a63e10be47ce9d0afbe4ecf296254014825518da"
  )
  assert.equal(transition.state, "authorized-after-oli-405-validation")
  assert.deepEqual(transition.authorization, {
    authorized: true,
    owner: "OLI-405",
    evidence: {
      type: "validated-pr-head",
      pullRequest: "https://github.com/OlivierBelaud/palas-wholesale/pull/41",
      headCommit: "afa252ff27239b90edfd1bd5421c00c9f33e2a26",
    },
  })
  assert.doesNotThrow(() => verifyTransitionAuthorization(transition))
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
  assert.match(workflow, /git worktree add --detach "\$CANDIDATE_WORKTREE"/)
  assert.match(workflow, /git clean -ffdx/)
  assert.match(workflow, /yarn pack --filename "\$CANDIDATE_RAW_TARBALL"/)
  assert.match(workflow, /prepare-release-candidate\.mjs/)
  assert.match(
    workflow,
    /npm publish "\$CANDIDATE_TARBALL" --tag medusa --provenance --access public/
  )
  assert.doesNotMatch(
    workflow,
    /run: npm publish --tag medusa --provenance --access public/
  )
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
  assert.match(documentation, /authorization PR itself does[\s\n]+not publish/)
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
  candidate: {
    commit: "8723df1c922e98b1fe74a28f38edee4d47a20b23",
    tarballSha256:
      "0ecca5c6c4908c6577299153a63e10be47ce9d0afbe4ecf296254014825518da",
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
  candidatePackageJson: candidatePackage,
  transition: authorizedTransition,
  actualTag: "medusa-dashboard-v0.1.18-medusa.0",
  targetCommitish: "main",
  isMainAncestor: true,
  isCandidateReleaseAncestor: true,
  githubEvidence: {
    baseRef: "refactor",
    checks: REQUIRED_B2B_CHECKS.map((name) => ({
      name,
      appSlug: "github-actions",
      source: "check-run",
      status: "completed",
      conclusion: "success",
      workflowEvent: "pull_request",
      workflowHeadCommit: "a".repeat(40),
      workflowPath: ".github/workflows/build.yml",
      workflowRepository: "OlivierBelaud/palas-wholesale",
      workflowRunId: "12345",
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
    /must use the Medusa Dashboard namespace/
  )
  assert.throws(
    () =>
      verifyRelease({
        ...validRelease,
        actualTag: "v0.1.18-medusa.0",
      }),
    /must use the Medusa Dashboard namespace/
  )
  assert.throws(
    () => verifyRelease({ ...validRelease, targetCommitish: "feature" }),
    /target_commitish must be main/
  )
  assert.throws(
    () => verifyRelease({ ...validRelease, isMainAncestor: false }),
    /contained in origin\/main/
  )
  assert.throws(
    () => verifyRelease({ ...validRelease, isCandidateReleaseAncestor: false }),
    /candidate commit must be an ancestor of the release commit/
  )
})

test("release guard binds the candidate package manifest", () => {
  for (const candidatePackageJson of [
    { ...candidatePackage, name: "@mantajs/dashboard" },
    { ...candidatePackage, version: "0.1.18-medusa.1" },
    { ...candidatePackage, publishConfig: { tag: "latest" } },
  ]) {
    assert.throws(
      () => verifyRelease({ ...validRelease, candidatePackageJson }),
      /candidate (package identity|package version|publishConfig)/
    )
  }
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
          checks: validRelease.githubEvidence.checks.map((check) => ({
            ...check,
            workflowHeadCommit: "c".repeat(40),
          })),
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
  for (const conclusion of ["neutral", "skipped"]) {
    assert.throws(
      () =>
        verifyRelease({
          ...validRelease,
          githubEvidence: {
            ...validRelease.githubEvidence,
            checks: REQUIRED_B2B_CHECKS.map((name, index) => ({
              name,
              appSlug: "github-actions",
              source: "check-run",
              status: "completed",
              conclusion: index === 0 ? conclusion : "success",
            })),
          },
        }),
      /expected successful GitHub Actions workflow run/
    )
  }
  assert.throws(
    () =>
      verifyRelease({
        ...validRelease,
        githubEvidence: {
          ...validRelease.githubEvidence,
          checks: [
            ...validRelease.githubEvidence.checks,
            {
              name: REQUIRED_B2B_CHECKS[0],
              appSlug: "github-actions",
              source: "check-run",
              status: "completed",
              conclusion: "neutral",
            },
          ],
        },
      }),
    /expected successful GitHub Actions workflow run/
  )
  assert.throws(
    () =>
      verifyRelease({
        ...validRelease,
        githubEvidence: {
          ...validRelease.githubEvidence,
          checks: validRelease.githubEvidence.checks.map((check, index) =>
            index === 0
              ? { ...check, appSlug: null, source: "commit-status" }
              : check
          ),
        },
      }),
    /expected successful GitHub Actions workflow run/
  )
  assert.throws(
    () =>
      verifyRelease({
        ...validRelease,
        githubEvidence: {
          ...validRelease.githubEvidence,
          checks: validRelease.githubEvidence.checks.map((check, index) =>
            index === 0
              ? { ...check, workflowPath: ".github/workflows/spoof.yml" }
              : check
          ),
        },
      }),
    /expected successful GitHub Actions workflow run/
  )
})

test("transition rejects missing or malformed candidate attestations", () => {
  assert.throws(
    () =>
      verifyTransitionAuthorization(
        { ...lockedTransition, candidate: undefined },
        { allowAwaiting: true }
      ),
    /exact Dashboard candidate commit/
  )
  assert.throws(
    () =>
      verifyTransitionAuthorization(
        {
          ...lockedTransition,
          candidate: { ...lockedTransition.candidate, tarballSha256: "bad" },
        },
        { allowAwaiting: true }
      ),
    /candidate tarball SHA-256/
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
        checks: validRelease.githubEvidence.checks.map((check) => ({
          ...check,
          workflowHeadCommit: "c".repeat(40),
        })),
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
          app: { slug: "github-actions" },
          conclusion: "success",
          details_url:
            "https://github.com/OlivierBelaud/palas-wholesale/actions/runs/12345/job/67890",
          name,
          status: "completed",
        })),
      }
    }
    if (endpoint.endsWith("/actions/runs/12345")) {
      return {
        event: "pull_request",
        head_sha: "a".repeat(40),
        path: ".github/workflows/build.yml",
        repository: { full_name: "OlivierBelaud/palas-wholesale" },
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
  assert.equal(requests.length, 4)
  assert.ok(requests.every(([, token]) => token === "test-token"))
})

test("candidate normalization canonicalizes source modes and validates its manifest", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "candidate-normalization-test-"))
  try {
    const packageRoot = join(fixture, "package")
    await mkdir(packageRoot)
    await mkdir(join(packageRoot, "bin"))
    await writeFile(join(packageRoot, "package.json"), JSON.stringify(candidatePackage))
    await writeFile(join(packageRoot, "index.js"), "export const value = 1\n")
    await writeFile(join(packageRoot, "bin/cli.js"), "#!/usr/bin/env node\n")
    const rawOne = join(fixture, "raw-one.tgz")
    const rawTwo = join(fixture, "raw-two.tgz")
    const finalOne = join(fixture, "final-one.tgz")
    const preparedOne = join(fixture, "prepared-one.tgz")
    const preparedTwo = join(fixture, "prepared-two.tgz")
    await chmod(packageRoot, 0o700)
    await chmod(join(packageRoot, "bin"), 0o700)
    await chmod(join(packageRoot, "package.json"), 0o600)
    await chmod(join(packageRoot, "index.js"), 0o600)
    await chmod(join(packageRoot, "bin/cli.js"), 0o700)
    execFileSync("tar", ["-czf", rawOne, "-C", fixture, "package"])
    await utimes(packageRoot, new Date(978_307_200_000), new Date(978_307_200_000))
    await chmod(packageRoot, 0o755)
    await chmod(join(packageRoot, "bin"), 0o755)
    await chmod(join(packageRoot, "package.json"), 0o644)
    await chmod(join(packageRoot, "index.js"), 0o644)
    await chmod(join(packageRoot, "bin/cli.js"), 0o755)
    execFileSync("tar", ["-czf", rawTwo, "-C", fixture, "package"])
    assert.notDeepEqual(await readFile(rawTwo), await readFile(rawOne))

    const expected = {
      ...lockedTransition,
      candidate: { ...lockedTransition.candidate, tarballSha256: "" },
    }
    // Establish the canonical digest independently with the documented GNU tar flags.
    const firstExtraction = join(fixture, "extract-one")
    await mkdir(firstExtraction)
    execFileSync("tar", ["-xzf", rawOne, "-C", firstExtraction])
    execFileSync("tar", [
      "--sort=name", "--mtime=UTC 1970-01-01", "--owner=0", "--group=0",
      "--numeric-owner", "--mode=u+rwX,go+rX,go-w", "-czf", finalOne,
      "-C", firstExtraction, "package",
    ])
    expected.candidate.tarballSha256 = createHash("sha256")
      .update(await readFile(finalOne))
      .digest("hex")
    prepareReleaseCandidate({
      input: rawOne,
      output: preparedOne,
      releasePackage: candidatePackage,
      transition: expected,
    })
    prepareReleaseCandidate({
      input: rawTwo,
      output: preparedTwo,
      releasePackage: candidatePackage,
      transition: expected,
    })
    assert.deepEqual(await readFile(preparedOne), await readFile(finalOne))
    assert.deepEqual(await readFile(preparedTwo), await readFile(finalOne))
    assert.deepEqual(await readFile(preparedTwo), await readFile(preparedOne))

    const normalizedExtraction = join(fixture, "normalized")
    await mkdir(normalizedExtraction)
    execFileSync("tar", [
      "--same-permissions",
      "-xzf",
      preparedTwo,
      "-C",
      normalizedExtraction,
    ])
    assert.equal(
      (await lstat(join(normalizedExtraction, "package"))).mode & 0o777,
      0o755
    )
    assert.equal(
      (await lstat(join(normalizedExtraction, "package/bin"))).mode & 0o777,
      0o755
    )
    assert.equal(
      (await lstat(join(normalizedExtraction, "package/package.json"))).mode & 0o777,
      0o644
    )
    assert.equal(
      (await lstat(join(normalizedExtraction, "package/index.js"))).mode & 0o777,
      0o644
    )
    assert.equal(
      (await lstat(join(normalizedExtraction, "package/bin/cli.js"))).mode & 0o777,
      0o755
    )

    const wrongIdentity = {
      ...expected,
      to: { ...expected.to, package: "@mantajs/not-the-candidate" },
    }
    assert.throws(
      () =>
        prepareReleaseCandidate({
          input: rawTwo,
          output: preparedTwo,
          releasePackage: candidatePackage,
          transition: wrongIdentity,
        }),
      /package identity must match/
    )
    assert.throws(
      () =>
        prepareReleaseCandidate({
          input: rawTwo,
          output: preparedTwo,
          releasePackage: {
            ...candidatePackage,
            publishConfig: { ...candidatePackage.publishConfig, tag: "latest" },
          },
          transition: expected,
        }),
      /publishConfig must match/
    )
  } finally {
    await rm(fixture, { force: true, recursive: true })
  }
})

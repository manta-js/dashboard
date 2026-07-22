import assert from "node:assert/strict"

export const AWAITING_OLI_405 = "awaiting-oli-405"
export const AUTHORIZED_AFTER_VALIDATION =
  "authorized-after-oli-405-validation"
export const AUTHORIZED_AFTER_MERGE = "authorized-after-oli-405"

const PULL_REQUEST_PATTERN =
  /^https:\/\/github\.com\/OlivierBelaud\/palas-wholesale\/pull\/\d+$/
const COMMIT_PATTERN = /^[0-9a-f]{40}$/

export const verifyTransitionAuthorization = (
  transition,
  { allowAwaiting = false } = {}
) => {
  assert.equal(transition.schemaVersion, 2)
  assert.equal(transition.authorization?.owner, "OLI-405")

  if (transition.state === AWAITING_OLI_405) {
    assert.equal(
      allowAwaiting,
      true,
      "release transition is locked until OLI-405 migration is authorized"
    )
    assert.equal(transition.authorization?.authorized, false)
    assert.equal(transition.authorization?.evidence, null)
    return
  }

  assert.equal(
    transition.authorization?.authorized,
    true,
    "OLI-405 must explicitly authorize the package release"
  )
  assert.match(
    transition.authorization?.evidence?.pullRequest || "",
    PULL_REQUEST_PATTERN,
    "authorization must record the validated OLI-405 pull request"
  )

  if (transition.state === AUTHORIZED_AFTER_VALIDATION) {
    assert.equal(
      transition.authorization?.evidence?.type,
      "validated-pr-head",
      "pre-merge authorization must identify a validated PR head"
    )
    assert.match(
      transition.authorization?.evidence?.headCommit || "",
      COMMIT_PATTERN,
      "authorization must record the exact validated OLI-405 head commit"
    )
    return
  }

  assert.equal(
    transition.state,
    AUTHORIZED_AFTER_MERGE,
    "unknown package transition state"
  )
  assert.equal(
    transition.authorization?.evidence?.type,
    "merged-pr",
    "post-merge authorization must identify merged PR evidence"
  )
  assert.match(
    transition.authorization?.evidence?.mergeCommit || "",
    COMMIT_PATTERN,
    "authorization must record the OLI-405 merge commit"
  )
}

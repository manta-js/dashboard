import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"

const PR_PATTERN =
  /^https:\/\/github\.com\/OlivierBelaud\/palas-wholesale\/pull\/(\d+)$/
const ACTIONS_RUN_PATTERN =
  /^https:\/\/github\.com\/OlivierBelaud\/palas-wholesale\/actions\/runs\/(\d+)(?:\/job\/\d+)?$/

export const REQUIRED_B2B_CHECKS = [
  "Build exact Medusa Dashboard candidate",
  "Backend contract, quality, coverage and build",
  "Backend module integration (PostgreSQL)",
  "Backend HTTP integration (PostgreSQL)",
  "Hermetic B2B critical journey (PostgreSQL)",
  "Storefront contract, quality, coverage, Playwright and build",
]

const requestGithub = (endpoint, token) =>
  JSON.parse(
    execFileSync("gh", ["api", endpoint], {
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: token },
    })
  )

export const loadGithubReleaseEvidence = (
  transition,
  {
    request = requestGithub,
    token = process.env.B2B_RELEASE_VALIDATION_TOKEN,
  } = {}
) => {
  assert.ok(
    token,
    "B2B_RELEASE_VALIDATION_TOKEN is required to verify private OLI-405 evidence"
  )
  const pullRequest = transition.authorization?.evidence?.pullRequest || ""
  const match = pullRequest.match(PR_PATTERN)
  assert.ok(match, "OLI-405 evidence must reference the B2B repository")
  const number = Number(match[1])
  const repository = "OlivierBelaud/palas-wholesale"
  const pr = request(`repos/${repository}/pulls/${number}`, token)
  const headCommit = pr.head?.sha
  const checkRunResponse = request(
    `repos/${repository}/commits/${headCommit}/check-runs?per_page=100`,
    token
  )
  const checkRuns = checkRunResponse.check_runs || []
  assert.ok(
    checkRunResponse.total_count === undefined ||
      checkRunResponse.total_count === checkRuns.length,
    "OLI-405 check runs exceed the verified GitHub page"
  )
  const statuses = request(
    `repos/${repository}/commits/${headCommit}/status?per_page=100`,
    token
  ).statuses
  const workflowRuns = new Map()
  for (const check of checkRuns) {
    if (!REQUIRED_B2B_CHECKS.includes(check.name)) {
      continue
    }
    const runId = check.details_url?.match(ACTIONS_RUN_PATTERN)?.[1]
    if (runId && !workflowRuns.has(runId)) {
      workflowRuns.set(
        runId,
        request(`repos/${repository}/actions/runs/${runId}`, token)
      )
    }
  }

  return {
    baseRef: pr.base?.ref,
    checks: [
      ...checkRuns.map((check) => {
        const workflowRunId = check.details_url?.match(ACTIONS_RUN_PATTERN)?.[1]
        const workflowRun = workflowRuns.get(workflowRunId)
        return {
          appSlug: check.app?.slug,
          conclusion: check.conclusion,
          name: check.name,
          source: "check-run",
          status: check.status,
          workflowEvent: workflowRun?.event,
          workflowHeadCommit: workflowRun?.head_sha,
          workflowPath: workflowRun?.path,
          workflowRepository: workflowRun?.repository?.full_name,
          workflowRunId,
        }
      }),
      ...(statuses || []).map((status) => ({
        appSlug: null,
        conclusion: status.state,
        name: status.context,
        source: "commit-status",
        status: "completed",
      })),
    ],
    headCommit,
    mergeCommit: pr.merge_commit_sha,
    merged: pr.merged,
    number: pr.number,
    state: pr.state,
    url: pr.html_url,
  }
}

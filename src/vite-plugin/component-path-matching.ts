import path from "node:path"

export const DASHBOARD_MODULE_EXTENSIONS = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mts",
  ".mjs",
]
export const DASHBOARD_MODULE_EXTENSION_SET = new Set(
  DASHBOARD_MODULE_EXTENSIONS
)
const DASHBOARD_MODULE_EXTENSION_PATTERN = /\.(tsx?|jsx?|mts|mjs)$/

export const getDashboardModuleStem = (filePath: string) =>
  path.basename(filePath).replace(DASHBOARD_MODULE_EXTENSION_PATTERN, "")

const normalizedSegments = (filePath: string) =>
  filePath
    .replace(/\\/g, "/")
    .replace(/\?.*$/, "")
    .split("/")
    .filter(Boolean)

const normalizedPath = (filePath: string) =>
  normalizedSegments(filePath).join("/")

export const isDashboardComponentFile = (filePath: string) =>
  getDashboardModuleStem(filePath) !== "index"

const matchingDirectorySuffixLength = (
  dashboardPath: string,
  overridePath: string
) => {
  const dashboard = normalizedSegments(dashboardPath).slice(0, -1)
  const override = normalizedSegments(overridePath).slice(0, -1)
  let matches = 0

  while (
    matches < dashboard.length &&
    matches < override.length &&
    dashboard[dashboard.length - 1 - matches] ===
      override[override.length - 1 - matches]
  ) {
    matches += 1
  }

  return matches
}

export const shouldApplyComponentOverride = (
  dashboardPath: string,
  overridePath: string,
  sameNameCandidates: string[]
) => {
  const selectedCandidate = findDashboardComponentForOverride(
    overridePath,
    sameNameCandidates
  )

  return (
    selectedCandidate !== undefined &&
    normalizedPath(selectedCandidate) === normalizedPath(dashboardPath)
  )
}

export const findDashboardComponentForOverride = (
  overridePath: string,
  sameNameCandidates: string[]
) => {
  if (sameNameCandidates.length === 1) {
    return sameNameCandidates[0]
  }

  return [...sameNameCandidates]
    .sort(
      (left, right) =>
        matchingDirectorySuffixLength(right, overridePath) -
          matchingDirectorySuffixLength(left, overridePath) ||
        path.normalize(left).localeCompare(path.normalize(right))
    )
    .find(
      (candidate) =>
        matchingDirectorySuffixLength(candidate, overridePath) > 0
    )
}

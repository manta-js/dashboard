import fs from "node:fs"
import path from "node:path"

import type { DashboardComponentOverride } from "./types"

const MODULE_EXTENSIONS = new Set([
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mts",
  ".mjs",
])
const OVERRIDE_ROOT = "src/admin/components/"
const TARGET_ROOT = "src/"

type ComponentOverridePolicyContext = {
  projectRoot: string
  dashboardSrc: string
}

const policyError = (index: number, reason: string) =>
  new Error(`[custom-dashboard] Invalid component override ${index}: ${reason}`)

const normalizeRelativePath = (
  value: string,
  index: number,
  field: "override" | "target"
) => {
  if (!value || path.isAbsolute(value)) {
    throw policyError(index, `${field} must be a non-empty relative path`)
  }

  const normalized = value.replace(/\\/g, "/")
  if (normalized.split("/").some((segment) => segment === "..")) {
    throw policyError(index, `${field} must not contain traversal segments`)
  }

  const requiredRoot = field === "override" ? OVERRIDE_ROOT : TARGET_ROOT
  if (!normalized.startsWith(requiredRoot)) {
    throw policyError(index, `${field} must be inside ${requiredRoot}`)
  }

  if (!MODULE_EXTENSIONS.has(path.extname(normalized))) {
    throw policyError(index, `${field} has an unsupported module extension`)
  }

  if (field === "target" && path.basename(normalized, path.extname(normalized)) === "index") {
    throw policyError(index, "target must not be a barrel module")
  }

  return normalized
}

const isWithin = (candidate: string, root: string) => {
  const relative = path.relative(root, candidate)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

const requireExistingPath = (
  candidate: string,
  root: string,
  index: number,
  field: "override" | "target"
) => {
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw policyError(index, `missing ${field}: ${candidate}`)
  }

  const realCandidate = fs.realpathSync(candidate)
  const realRoot = fs.realpathSync(root)
  if (!isWithin(realCandidate, realRoot)) {
    throw policyError(index, `${field} resolves outside its approved root`)
  }

  return realCandidate
}

const normalizeResolvedId = (id: string) => {
  const normalized = path.normalize(
    id.replace(/^\0/, "").replace(/\?.*$/, "")
  )
  return fs.existsSync(normalized) ? fs.realpathSync(normalized) : normalized
}

export const createComponentOverridePolicy = (
  entries: readonly DashboardComponentOverride[] | undefined,
  { projectRoot, dashboardSrc }: ComponentOverridePolicyContext
) => {
  const overridesByTarget = new Map<string, string>()
  const seenOverrides = new Set<string>()

  for (const [index, entry] of (entries ?? []).entries()) {
    const overrideRelative = normalizeRelativePath(
      entry.override,
      index,
      "override"
    )
    const targetRelative = normalizeRelativePath(entry.target, index, "target")
    const overridePath = requireExistingPath(
      path.resolve(projectRoot, overrideRelative),
      path.resolve(projectRoot, "src/admin/components"),
      index,
      "override"
    )
    const targetPath = requireExistingPath(
      path.resolve(dashboardSrc, targetRelative.slice(TARGET_ROOT.length)),
      dashboardSrc,
      index,
      "target"
    )
    const normalizedOverride = normalizeResolvedId(overridePath)
    const normalizedTarget = normalizeResolvedId(targetPath)

    if (seenOverrides.has(normalizedOverride)) {
      throw policyError(index, `duplicate override: ${entry.override}`)
    }
    if (overridesByTarget.has(normalizedTarget)) {
      throw policyError(index, `duplicate target: ${entry.target}`)
    }

    seenOverrides.add(normalizedOverride)
    overridesByTarget.set(normalizedTarget, overridePath)
  }

  return {
    getOverrideForTarget(resolvedTarget: string) {
      return overridesByTarget.get(normalizeResolvedId(resolvedTarget))
    },
    size: overridesByTarget.size,
  }
}

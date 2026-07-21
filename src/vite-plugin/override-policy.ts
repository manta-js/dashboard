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

export type NormalizedComponentOverride = {
  entry: number
  override: string
  target: string
  overridePath: string
  targetPath: string
}

const redactPath = (value: string) =>
  path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)
    ? "[absolute]"
    : value.replace(/\\/g, "/")

export class ComponentOverridePolicyError extends Error {
  constructor(
    readonly entry: number,
    readonly reasonCode: string,
    readonly override: string,
    readonly target: string,
    reason: string
  ) {
    super(`[custom-dashboard] Invalid component override ${entry}: ${reason}`)
    this.name = "ComponentOverridePolicyError"
  }
}

const policyError = (
  index: number,
  entry: DashboardComponentOverride,
  reasonCode: string,
  reason: string
) =>
  new ComponentOverridePolicyError(
    index,
    reasonCode,
    redactPath(entry.override),
    redactPath(entry.target),
    reason
  )

const normalizeRelativePath = (
  value: string,
  index: number,
  field: "override" | "target",
  entry: DashboardComponentOverride
) => {
  if (!value || path.isAbsolute(value)) {
    throw policyError(
      index,
      entry,
      `${field}.absolute`,
      `${field} must be a non-empty relative path`
    )
  }

  const normalized = value.replace(/\\/g, "/")
  if (normalized.split("/").some((segment) => segment === "..")) {
    throw policyError(
      index,
      entry,
      `${field}.traversal`,
      `${field} must not contain traversal segments`
    )
  }

  const requiredRoot = field === "override" ? OVERRIDE_ROOT : TARGET_ROOT
  if (!normalized.startsWith(requiredRoot)) {
    throw policyError(
      index,
      entry,
      `${field}.outside-root`,
      `${field} must be inside ${requiredRoot}`
    )
  }

  if (!MODULE_EXTENSIONS.has(path.extname(normalized))) {
    throw policyError(
      index,
      entry,
      `${field}.unsupported-extension`,
      `${field} has an unsupported module extension`
    )
  }

  if (field === "target" && path.basename(normalized, path.extname(normalized)) === "index") {
    throw policyError(
      index,
      entry,
      "target.barrel",
      "target must not be a barrel module"
    )
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
  field: "override" | "target",
  entry: DashboardComponentOverride
) => {
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw policyError(
      index,
      entry,
      `${field}.missing`,
      `missing ${field}: ${redactPath(entry[field])}`
    )
  }

  const realCandidate = fs.realpathSync(candidate)
  const realRoot = fs.realpathSync(root)
  if (!isWithin(realCandidate, realRoot)) {
    throw policyError(
      index,
      entry,
      `${field}.outside-root`,
      `${field} resolves outside its approved root`
    )
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
  const overridesByTarget = new Map<string, NormalizedComponentOverride>()
  const entriesByOverride = new Map<string, NormalizedComponentOverride>()
  const seenOverrides = new Set<string>()
  const normalizedEntries: NormalizedComponentOverride[] = []

  for (const [index, entry] of (entries ?? []).entries()) {
    const overrideRelative = normalizeRelativePath(
      entry.override,
      index,
      "override",
      entry
    )
    const targetRelative = normalizeRelativePath(
      entry.target,
      index,
      "target",
      entry
    )
    const overridePath = requireExistingPath(
      path.resolve(projectRoot, overrideRelative),
      path.resolve(projectRoot, "src/admin/components"),
      index,
      "override",
      entry
    )
    const targetPath = requireExistingPath(
      path.resolve(dashboardSrc, targetRelative.slice(TARGET_ROOT.length)),
      dashboardSrc,
      index,
      "target",
      entry
    )
    const normalizedOverride = normalizeResolvedId(overridePath)
    const normalizedTarget = normalizeResolvedId(targetPath)

    if (seenOverrides.has(normalizedOverride)) {
      throw policyError(
        index,
        entry,
        "override.duplicate",
        `duplicate override: ${redactPath(entry.override)}`
      )
    }
    if (overridesByTarget.has(normalizedTarget)) {
      throw policyError(
        index,
        entry,
        "target.duplicate",
        `duplicate target: ${redactPath(entry.target)}`
      )
    }

    const normalizedEntry = {
      entry: index,
      override: overrideRelative,
      target: targetRelative,
      overridePath,
      targetPath,
    }
    seenOverrides.add(normalizedOverride)
    overridesByTarget.set(normalizedTarget, normalizedEntry)
    entriesByOverride.set(normalizedOverride, normalizedEntry)
    normalizedEntries.push(normalizedEntry)
  }

  return {
    entries: normalizedEntries as readonly NormalizedComponentOverride[],
    getEntryForOverridePath(overridePath: string) {
      return entriesByOverride.get(normalizeResolvedId(overridePath))
    },
    getEntryForTarget(resolvedTarget: string) {
      return overridesByTarget.get(normalizeResolvedId(resolvedTarget))
    },
    getOverrideForTarget(resolvedTarget: string) {
      return overridesByTarget.get(normalizeResolvedId(resolvedTarget))
        ?.overridePath
    },
    size: overridesByTarget.size,
  }
}

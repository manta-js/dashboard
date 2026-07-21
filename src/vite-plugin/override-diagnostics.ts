import path from "node:path"

import type {
  DashboardComponentOverride,
  DashboardOverrideDecision,
  DashboardOverrideDiagnostic,
  DashboardOverrideDiagnosticKind,
  DashboardOverrideSummary,
  CustomDashboardPluginOptions,
} from "./types"
import type {
  ComponentOverridePolicyError,
  NormalizedComponentOverride,
} from "./override-policy"

const redactConfiguredPath = (value: string) => {
  const normalized = value.replace(/\\/g, "/")
  return path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)
    ? "[absolute]"
    : normalized
}

export class OverrideDiagnostics {
  private sequence = 0
  private readonly accepted = new Map<number, NormalizedComponentOverride>()
  private readonly applied = new Set<number>()
  private readonly rejected = new Map<number, DashboardOverrideDecision>()
  private readonly unmatchedEmitted = new Set<number>()
  private lastPublishedSummary: string | undefined

  constructor(
    private readonly configuredEntries: readonly DashboardComponentOverride[],
    private readonly onDiagnostic?: CustomDashboardPluginOptions["onDiagnostic"],
    private readonly onSummary?: CustomDashboardPluginOptions["onSummary"]
  ) {
    this.emit({ kind: "policy-loaded", configured: configuredEntries.length })
  }

  accept(entry: NormalizedComponentOverride) {
    this.accepted.set(entry.entry, entry)
    this.emitEntry("accepted", entry)
  }

  reject(error: ComponentOverridePolicyError) {
    const decision: DashboardOverrideDecision = {
      entry: error.entry,
      override: redactConfiguredPath(error.override),
      target: redactConfiguredPath(error.target),
      status: "rejected",
      reasonCode: error.reasonCode,
    }
    this.rejected.set(error.entry, decision)
    this.emit({
      kind: "rejected",
      entry: decision.entry,
      override: decision.override,
      target: decision.target,
      reasonCode: decision.reasonCode,
    })
    this.publishSummary()
  }

  apply(entry: NormalizedComponentOverride) {
    if (this.applied.has(entry.entry)) return
    this.applied.add(entry.entry)
    this.emitEntry("applied", entry)
  }

  lifecycle(
    kind: Extract<DashboardOverrideDiagnosticKind, "deleted" | "restored">,
    entry: NormalizedComponentOverride
  ) {
    this.emitEntry(kind, entry)
  }

  finalize() {
    for (const entry of this.accepted.values()) {
      if (
        !this.applied.has(entry.entry) &&
        !this.unmatchedEmitted.has(entry.entry)
      ) {
        this.unmatchedEmitted.add(entry.entry)
        this.emitEntry("unmatched", entry)
      }
    }
    this.publishSummary()
  }

  getSummary(): DashboardOverrideSummary {
    const decisions = [
      ...[...this.accepted.values()].map<DashboardOverrideDecision>((entry) => ({
        entry: entry.entry,
        override: entry.override,
        target: entry.target,
        status: this.applied.has(entry.entry) ? "applied" : "unmatched",
      })),
      ...this.rejected.values(),
    ].sort((left, right) => left.entry - right.entry)

    return {
      schemaVersion: 1,
      configured: this.configuredEntries.length,
      accepted: this.accepted.size,
      applied: this.applied.size,
      rejected: this.rejected.size,
      unmatched: [...this.accepted.keys()].filter(
        (entry) => !this.applied.has(entry)
      ).length,
      decisions,
    }
  }

  private emitEntry(
    kind: DashboardOverrideDiagnosticKind,
    entry: NormalizedComponentOverride
  ) {
    this.emit({
      kind,
      entry: entry.entry,
      override: entry.override,
      target: entry.target,
    })
  }

  private emit(
    event: Omit<DashboardOverrideDiagnostic, "schemaVersion" | "sequence">
  ) {
    const versionedEvent: DashboardOverrideDiagnostic = {
      schemaVersion: 1,
      sequence: this.sequence++,
      ...event,
    }
    this.onDiagnostic?.(versionedEvent)
  }

  private publishSummary() {
    const summary = this.getSummary()
    const serialized = JSON.stringify(summary)
    if (serialized === this.lastPublishedSummary) return
    this.lastPublishedSummary = serialized
    this.onSummary?.(summary)
  }
}

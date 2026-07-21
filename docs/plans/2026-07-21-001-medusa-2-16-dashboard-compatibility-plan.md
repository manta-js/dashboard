# OLI-394 — Medusa 2.16 dashboard compatibility

## Objective

Upgrade the standalone `manta-js/dashboard` fork to the minimal Medusa 2.16
dashboard contract required by B2B, while preserving Manta's component/route/menu
overrides and its public Vite plugin. Prove the published package shape from an
installed tarball before any npm release is considered.

## Context and constraints

- The B2B Medusa 2.16 build imports
  `@medusajs/dashboard/components` from `@medusajs/draft-order` and expects
  `LayoutComposer`.
- The current fork is based on Medusa 2.13.1 and only exports `.`, `./css`,
  `./vite-plugin`, `./root`, and `./package.json`.
- `manta-js/dashboard` is an autonomous GitHub repository. Its target branch is
  `main`; no PALAS workspace-root Git operation is allowed.
- npm publication is triggered only by publishing a GitHub Release
  (`.github/workflows/publish.yml`). This plan produces a validated tarball and
  a merge-ready PR, but does not publish a release without the reconciled release
  authorization.
- The shared npm name also carries the generic package's `0.2.x` beta line.
  This Medusa fork therefore uses the isolated `0.1.18-medusa.0` prerelease and
  the explicit `medusa` dist-tag; consumers must pin it exactly.
- Existing public APIs and custom behavior must remain compatible, especially
  `customDashboardPlugin`, `menuConfigPlugin`, menu types, component overrides,
  route overrides, and the alias-based B2B installation topology.

## Requirements

| ID | Requirement | Verification |
| --- | --- | --- |
| R1 | Runtime dashboard source and Medusa packages align with 2.16.0. | Frozen install, typecheck, build, tests. |
| R2 | `@mantajs/dashboard/components` exports a working `LayoutComposer`. | Source/export test and installed-tarball consumer import. |
| R3 | Existing root, CSS, package metadata and Vite-plugin exports remain available. | Package export manifest test and installed-tarball consumer imports. |
| R4 | Manta component, route and menu override behavior survives the source upgrade. | Existing tests plus focused route/menu/plugin regression tests. |
| R5 | The exact B2B Yarn alias topology can install and resolve the packed fork. | Disposable consumer with `@medusajs/dashboard` aliased to the local tarball. |
| R6 | The repository ships through its declared GitHub Release policy only, on the isolated `medusa` prerelease channel. | PR targets `main`; release guard and package contract require the `medusa` line/tag; no npm publish or GitHub Release in this task. |

## Implementation units

### U1 — Rebase the fork on Medusa dashboard 2.16

- Replace the vendored Medusa 2.13 dashboard source with the official 2.16.0
  source tree.
- Align Medusa runtime/dev dependencies and Zod with the official 2.16 package
  graph, retaining only fork-specific build and Vite-plugin dependencies.
- Preserve the repository package identity and release metadata.

Acceptance: install, typecheck and the dashboard distribution build complete
against a coherent 2.16 dependency graph.

### U2 — Preserve Manta extensions and expose the 2.16 public component contract

- Port the custom menu configuration, route merge semantics, local-plugin
  precedence and unbundled component override Vite plugin onto the 2.16 source.
- Add the official `LayoutComposer` public entry and `./components` export.
- Preserve `./vite-plugin` and every pre-existing export path.

Acceptance: focused source tests cover route merging and Vite-plugin behavior;
the package manifest exposes both new and legacy paths.

### U3 — Prove the distributable package, not only the source tree

- Add deterministic package-contract checks for required files and exports.
- Pack the repository and install that tarball into a disposable consumer using
  the same Yarn alias shape as B2B:
  `@medusajs/dashboard: npm:@mantajs/dashboard@<tarball>` (or the local-tarball
  equivalent supported by Yarn for the proof).
- Import the aliased root, `components`, and Vite-plugin entries and assert
  `LayoutComposer` and `customDashboardPlugin` are functions.

Acceptance: the clean installed consumer resolves all required entries without
reaching into source paths.

### U4 — Certify and ship the PR

- Run frozen install, typecheck, tests, i18n validation, production package
  build, preview build, package-contract tests, installed-tarball proof,
  dependency audit, and `git diff --check`.
- Run Compound Engineering simplify/review as applicable and resolve actionable
  findings.
- Commit, push, open a PR to `main`, and babysit all CI checks until merge-ready.
- Provide the stable tarball path/version to OLI-392 for cross-repository Admin
  build validation. Do not merge or publish npm from this task.

## Risks and mitigations

- **Large upstream source delta:** import the official 2.16 source mechanically,
  then port the small, enumerated Manta delta with focused tests.
- **False confidence from source imports:** make the installed tarball consumer
  proof a required gate.
- **React provider split:** export `LayoutComposer` from the same upgraded source
  tree and provider context as the Manta dashboard runtime; do not alias the
  official package as a second React/dashboard instance.
- **Vite-plugin regression:** keep its entry independently compiled and exercise
  its exported API and alias-driven source discovery.
- **Accidental release:** the workflow only publishes on GitHub Release; stop at
  a green PR and coordinate release authorization with the root agent.

## Post-deploy monitoring and validation

After an authorized npm release, install the released version in B2B, confirm
the resolved package graph and rerun the Medusa backend/Admin build. In the first
deployed Admin session, monitor browser console errors, extension registration,
draft-order navigation, route overrides and custom-menu rendering. Roll back the
B2B resolution to the prior package version if the dashboard fails before any
production data mutation.

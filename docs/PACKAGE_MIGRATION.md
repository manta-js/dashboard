# Medusa dashboard package migration

## Current boundary

OLI-398 prepares, but does not publish, `@mantajs/medusa-dashboard`. The B2B
application remains unchanged and continues to resolve the exact rollback
package `@mantajs/dashboard@0.1.18-medusa.0`. The generic
`@mantajs/dashboard@0.2.x` line is a different package lineage and must never be
overwritten or deprecated as part of this transition.

The public registry returned no metadata for `@mantajs/medusa-dashboard` during
the read-only OLI-398 preflight on 2026-07-21. An HTTP 404 does not prove scope
ownership or publisher permission; those must be confirmed during a separately
authorized release.

## Staged ownership

1. OLI-398 builds and packs the renamed candidate, maintains the release lock,
   and changes no B2B dependency or production configuration.
2. OLI-405 installs the candidate in B2B, records the explicit target map,
   removes the B2B-local resolver, proves one plugin registration, zero deep
   imports, and equivalent development/production override decisions.
3. Only after OLI-405 is merged may an authorized operator update
   `release/medusa-dashboard-transition.json` to
   `authorized-after-oli-405`, set `authorization.authorized` to `true`, and
   record the merged PR URL and full 40-character merge commit.
4. A separate published GitHub Release targeting a commit contained in `main`
   may then run the protected npm workflow.
5. Roll out B2B and observe the configured, applied, rejected, and unmatched
   override counts before closing the rollback window.
6. Only after successful rollout may old Medusa-fork prereleases under
   `@mantajs/dashboard` be deprecated with a migration message. Never deprecate
   or modify its generic `0.2.x` versions.

## Rollback

Restore the B2B resolution and lockfile to
`@mantajs/dashboard@0.1.18-medusa.0` and its prior plugin configuration. Do not
delete npm history, overwrite a version, force-publish, or alter the generic
dashboard package line.

## No-release guarantee for OLI-398

The publish workflow has only the GitHub `release.published` trigger; pushes and
pull requests cannot invoke it. Package-contract tests keep the transition in
`awaiting-oli-405` with no authorization evidence, while the release verifier
requires the opposite authorized state before `npm publish` can run. OLI-398
does not publish, deprecate, create a GitHub Release, deploy, or change B2B.

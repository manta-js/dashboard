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
3. OLI-405 opens a B2B PR against `refactor` using the exact candidate archive
   produced from Dashboard commit
   `8723df1c922e98b1fe74a28f38edee4d47a20b23`, with archive SHA-256
   `0ecca5c6c4908c6577299153a63e10be47ce9d0afbe4ecf296254014825518da`.
   These values are recorded in the transition manifest. All B2B gates must pass on one immutable
   40-character PR head SHA; the candidate archive is test input, not a
   committed dependency or a production deployment.
4. After that validation, and only with explicit release authorization, an
   operator may update `release/medusa-dashboard-transition.json` to
   `authorized-after-oli-405-validation`, set `authorization.authorized` to
   `true`, and record evidence type `validated-pr-head`, the B2B PR URL, and its
   exact `headCommit`. If OLI-405 was already merged using another valid
   bootstrap mechanism, `authorized-after-oli-405` instead records evidence
   type `merged-pr` and the full `mergeCommit`.
5. A separate published GitHub Release targeting a commit contained in `main`
   may then run the protected npm workflow. The protected
   `npm-medusa-dashboard` environment must provide a private-repository token as
   `B2B_RELEASE_VALIDATION_TOKEN`; the release guard fetches the recorded PR,
   verifies its `refactor` base, immutable head or merge SHA, and green checks.
   Every required check, including `Build exact Medusa Dashboard candidate`,
   must be a GitHub Actions check run and conclude `success`; legacy commit
   statuses, checks from another app, `neutral`, and `skipped` are rejected.
   Neither a green OLI-405 PR nor this manifest schema grants release
   authorization by itself. After authorization is verified, the workflow
   checks out the recorded Dashboard candidate commit in a fresh worktree,
   rebuilds it with `yarn pack`, then canonicalizes the archive with sorted
   entries, epoch mtimes, numeric owner/group `0`, and permissions normalized
   to readable files plus executable directories and originally executable
   files. It verifies the internal package identity and recorded SHA-256 before
   publishing that exact archive.
   It never publishes the later authorization/tag checkout.
6. Replace the candidate archive in the same B2B PR with the exact published
   npm version, rerun every B2B gate, then merge OLI-405 into `refactor`.
7. Roll out B2B and observe the configured, applied, rejected, and unmatched
   override counts before closing the rollback window.
8. Only after successful rollout may old Medusa-fork prereleases under
   `@mantajs/dashboard` be deprecated with a migration message. Never deprecate
   or modify its generic `0.2.x` versions.

## Rollback

Restore the B2B resolution and lockfile to
`@mantajs/dashboard@0.1.18-medusa.0` and its prior plugin configuration. Do not
delete npm history, overwrite a version, force-publish, or alter the generic
dashboard package line.

## No-release guarantee before explicit authorization

The publish workflow has only the GitHub `release.published` trigger; pushes and
pull requests cannot invoke it. Package-contract tests keep the transition in
`awaiting-oli-405` with no authorization evidence, while the release verifier
requires the opposite authorized state plus immutable OLI-405 evidence before
`npm publish` can run. OLI-398 and OLI-415 do not publish, deprecate, create a
GitHub Release, deploy, or change B2B.

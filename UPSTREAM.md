# Upstream provenance

The dashboard source is vendored from the official Medusa dashboard package so
Manta can remain a drop-in, source-customizable replacement.

## Current baseline

- Package: `@medusajs/dashboard@2.16.0`
- npm tarball: `medusajs-dashboard-2.16.0.tgz`
- SHA-1: `6d2e7f0ec4e87410a63510ef3e64c23d1a365a9a`
- npm integrity:
  `sha512-VnZd48MJaWckAFtKt9tOoXnYBcwAOImD8a1iksdMt/2CQTYcBYRUHpip+DDBOZI5kksbYD9KnYOdY7mpZBNifQ==`
- Official Git tag: `medusajs/medusa@v2.16.0`

## Fork-owned delta

Manta intentionally keeps the following behavior on top of that source:

- the `@mantajs/dashboard/vite-plugin` entry and recursive component overrides;
- custom menu configuration and extension-menu de-duplication;
- route overrides that retain unmatched core child routes;
- extension plugin precedence and non-mutating menu sorting;
- inherited compatibility fixes for route handles, empty linked-field queries,
  form defaults, Vite environment names, CSS workflow classes, and the public
  `AdminReservation` type import;
- package/build/export tests, including the `./components` `LayoutComposer`
  contract and a packed Yarn alias consumer.

When upgrading again, replace the vendored `src/` tree from the official npm
tarball, reapply this enumerated delta, and rerun the full package plus installed
consumer gates before release.

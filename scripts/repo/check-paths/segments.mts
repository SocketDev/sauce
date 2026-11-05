// Path-segment vocabulary for the check-paths code scan (scan-code.mts):
// stage, build-root, mode, and sibling-package names.

// "Stage" segments — Rule A core. Two of these spread via `path.join`
// or interpolated into a template literal is a finding outside a
// canonical `paths.mts`. Sourced from build-infra/lib/constants.mts
// `BUILD_STAGES` plus their lowercase directory-name siblings used by
// some builders.
export const STAGE_SEGMENTS = new Set([
  'Compressed',
  'downloaded',
  'Final',
  'Optimized',
  'Release',
  'Stripped',
  'Synced',
  'wasm',
])

// "Build-root" segments — at least one must be present together with
// a stage segment to confirm we're constructing a build output path
// rather than something coincidental. Example: a join that yields
// `<root>/<stage>/<lib>` doesn't fire if no build-root segment is
// present; `<root>/build/<stage>/out/<stage>` does.
export const BUILD_ROOT_SEGMENTS = new Set(['build', 'out'])

// Build-mode segments — a stage segment plus one of these is also a
// finding (`build/<mode>/<arch>/out/<stage>` is the canonical shape).
export const MODE_SEGMENTS = new Set(['dev', 'prod', 'shared'])

// Sibling Socket packages, Rule B. A path that reaches into one of
// these packages is a finding.
export const KNOWN_SIBLING_PACKAGES = new Set([
  'acorn',
  'bin-infra',
  'bin-stub-builder',
  'binflate',
  'binject',
  'binpress',
  'build-infra',
  'cli',
  'codet5-models-builder',
  'core',
  'curl-builder',
  'libpq-builder',
  'lief-builder',
  'minilm-builder',
  'models',
  'napi-go',
  'node-smol-builder',
  'npm',
  'onnxruntime-builder',
  'opentui-builder',
  'package-builder',
  'react',
  'renderer',
  'ultraviolet',
  'ultraviolet-builder',
  'yoga',
  'yoga-layout-builder',
])

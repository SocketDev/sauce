/**
 * @file Type shim for the release-anchor chain. The kit defers CI auto-bump
 *   (deferral 1), so the anchor RESOLVER — the tag → bump-commit → publish-date
 *   walk that decides which commit a release sits on — does not ship. Two
 *   registry readers still import its result type, so only the type lives here.
 *   Node strips a type-only import at runtime, but the typecheck gate needs the
 *   file to exist.
 */

/**
 * What a registry answered when asked for a package's latest version.
 * `reachable: true, latest: undefined` is a definitive "never published";
 * `reachable: false` is "we do not know" and must never be read as unpublished.
 */
export type RegistryLatestRead =
  | { latest: string | undefined; reachable: true }
  | { reachable: false }

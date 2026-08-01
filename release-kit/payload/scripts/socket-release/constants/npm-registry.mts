/**
 * @file The single canonical npm registry the fleet talks to, plus the two
 *   derivations every registry caller needs: the packument URL for a package
 *   and the `.npmrc` auth-token key. The fleet publishes provenance-signed
 *   tarballs to public npm, so this is npmjs.org — not a Socket-owned
 *   registry. Change it in ONE place and everything follows.
 */

export const NPM_REGISTRY_URL = 'https://registry.npmjs.org'

export const NPM_REGISTRY_HOST = new URL(NPM_REGISTRY_URL).host

/**
 * The packument URL for a package name. encodeURIComponent escapes a scope's
 * leading `@` to `%40`, which the registry path rejects, so it is un-escaped
 * back — the one subtle rule every registry read shares.
 */
export function packumentUrl(name: string): string {
  return `${NPM_REGISTRY_URL}/${encodeURIComponent(name).replace('%40', '@')}`
}

/**
 * The registry-scoped auth-token key npm/pnpm read from and write to `.npmrc`.
 */
export const NPM_AUTH_TOKEN_KEY = `//${NPM_REGISTRY_HOST}/:_authToken`

/**
 * @file Pure formula rendering/parsing/planning for the binary-download
 *   Homebrew model (no bottles, no source build): one `Formula/<name>.rb`
 *   whose four platform blocks each pin an exact
 *   `releases/download/v<version>/<asset>` URL (release-pins-are-canonical —
 *   never `latest`) and the sha256 the release's own checksums.txt vouched
 *   for. `parseFormula` returns undefined on anything it cannot read —
 *   callers treat that as replace-whole-file, never a crash — and
 *   `planFormulaBump` answers create/update/unchanged so an identical bump
 *   is a structural no-op.
 */

export const FORMULA_PLATFORMS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
] as const

export type FormulaPlatform = (typeof FORMULA_PLATFORMS)[number]

export interface FormulaSpec {
  className: string
  desc: string
  homepage: string
  license: string
  name: string
  platforms: Record<FormulaPlatform, { sha256: string; url: string }>
}

/**
 * Render the exact managed formula. Byte-stable: same spec, same bytes.
 */
export function renderFormula(spec: FormulaSpec): string {
  const p = spec.platforms
  return `# Managed by socket-release-kit (scripts/socket-release/brew-publish.mts).
# Do not hand-edit: the next formula bump rewrites this file from the
# release's own checksums.txt.
class ${spec.className} < Formula
  desc "${spec.desc}"
  homepage "${spec.homepage}"
  version "${versionFromUrl(p['darwin-arm64'].url) ?? ''}"
  license "${spec.license}"

  on_macos do
    on_arm do
      url "${p['darwin-arm64'].url}"
      sha256 "${p['darwin-arm64'].sha256}"
    end
    on_intel do
      url "${p['darwin-x64'].url}"
      sha256 "${p['darwin-x64'].sha256}"
    end
  end

  on_linux do
    on_arm do
      url "${p['linux-arm64'].url}"
      sha256 "${p['linux-arm64'].sha256}"
    end
    on_intel do
      url "${p['linux-x64'].url}"
      sha256 "${p['linux-x64'].sha256}"
    end
  end

  def install
    bin.install "${spec.name}"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/${spec.name} --version")
  end
end
`
}

/**
 * The `v<version>` segment of an exact release-download URL.
 */
export function versionFromUrl(url: string): string | undefined {
  const m = /\/releases\/download\/v([^/]+)\//.exec(url)
  return m?.[1]
}

export interface ParsedFormula {
  className: string | undefined
  name: string | undefined
  platforms: Partial<Record<FormulaPlatform, { sha256: string; url: string }>>
  version: string | undefined
}

/**
 * Parse a managed (or foreign) formula. Returns undefined when the file
 * cannot be read as a formula at all — the caller treats that as
 * replace-whole-file, never a crash.
 */
export function parseFormula(raw: string): ParsedFormula | undefined {
  const cls = /class\s+([A-Za-z0-9]+)\s*<\s*Formula/.exec(raw)
  if (!cls) {
    return undefined
  }
  const version = /^\s*version\s+"([^"]+)"/m.exec(raw)?.[1]
  const name = /bin\.install\s+"([^"]+)"/.exec(raw)?.[1]
  const platforms: ParsedFormula['platforms'] = {}
  const os: Array<['on_macos' | 'on_linux', 'darwin' | 'linux']> = [
    ['on_macos', 'darwin'],
    ['on_linux', 'linux'],
  ]
  for (let i = 0, { length } = os; i < length; i += 1) {
    const [marker, prefix] = os[i]!
    const blockStart = raw.indexOf(marker)
    if (blockStart === -1) {
      continue
    }
    const nextOs = os[1 - i]![0]
    const blockEnd =
      raw.indexOf(nextOs, blockStart + 1) === -1
        ? raw.length
        : raw.indexOf(nextOs, blockStart + 1)
    const block =
      blockEnd > blockStart
        ? raw.slice(blockStart, blockEnd)
        : raw.slice(blockStart)
    const arch: Array<['on_arm' | 'on_intel', 'arm64' | 'x64']> = [
      ['on_arm', 'arm64'],
      ['on_intel', 'x64'],
    ]
    for (let a = 0, { length: al } = arch; a < al; a += 1) {
      const [archMarker, archName] = arch[a]!
      const archStart = block.indexOf(archMarker)
      if (archStart === -1) {
        continue
      }
      const other = arch[1 - a]![0]
      const otherAt = block.indexOf(other, archStart + 1)
      const archBlock = block.slice(
        archStart,
        otherAt === -1 ? undefined : otherAt,
      )
      const url = /url\s+"([^"]+)"/.exec(archBlock)?.[1]
      const sha256 = /sha256\s+"([0-9a-f]{64})"/.exec(archBlock)?.[1]
      if (url && sha256) {
        platforms[`${prefix}-${archName}` as FormulaPlatform] = { sha256, url }
      }
    }
  }
  return { className: cls[1], name, platforms, version }
}

export interface FormulaBumpPlan {
  action: 'create' | 'unchanged' | 'update'
  rendered: string
}

/**
 * Plan the bump: no current file → create; identical version + all four
 * url/sha256 pairs → unchanged; anything else (including an unparseable
 * current file) → update, replace-whole-file.
 */
export function planFormulaBump(
  current: string | undefined,
  desired: FormulaSpec,
): FormulaBumpPlan {
  const rendered = renderFormula(desired)
  if (current === undefined) {
    return { action: 'create', rendered }
  }
  if (current === rendered) {
    return { action: 'unchanged', rendered }
  }
  const parsed = parseFormula(current)
  if (parsed) {
    const desiredVersion = versionFromUrl(desired.platforms['darwin-arm64'].url)
    const samePlatforms = FORMULA_PLATFORMS.every(p => {
      const cur = parsed.platforms[p]
      const want = desired.platforms[p]
      return (
        cur !== undefined && cur.url === want.url && cur.sha256 === want.sha256
      )
    })
    if (parsed.version === desiredVersion && samePlatforms) {
      return { action: 'unchanged', rendered }
    }
  }
  return { action: 'update', rendered }
}

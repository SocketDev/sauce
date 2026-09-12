// The trusted-publisher collection endpoint. GET lists a crate's configs, POST
// creates one; both take the API token in the `authorization` header and
// require the `trusted-publishing` endpoint scope plus crate ownership.
export const TRUSTPUB_GITHUB_CONFIGS_URL =
  'https://crates.io/api/v1/trusted_publishing/github_configs'

// The printable characters crates.io rejects inside an environment name — they
// would break the claim matching it does at OIDC-exchange time. The registry
// also rejects C0 + DEL control characters, which `environmentProblem` checks
// by code point rather than spelling a control byte into this source file.
const REJECTED_ENVIRONMENT_CHARS = '\'"`,;\\'

// The workflow basenames that carry the fleet's `cargo publish` job. crates.io
// stores a BASENAME, it rejects a path, so the config's `workflow_filename` is
// exactly one of these.
export const CARGO_PUBLISH_WORKFLOW_BASENAMES = [
  'cargo-publish.yaml',
  'cargo-publish.yml',
]

export interface TrustedPublisherTarget {
  // The CI environment gating the publish job, or undefined when the job runs
  // ungated (crates.io stores `null` for that).
  environment?: string | undefined
  repositoryName: string
  repositoryOwner: string
  workflowFilename: string
}

// A stored config as crates.io returns it (snake_case, `environment` nullable).
export interface GitHubConfigRow {
  crate: string
  environment?: string | null | undefined
  id: number
  repository_name: string
  repository_owner: string
  workflow_filename: string
}

export type TrustedPublisherStatus =
  | 'created'
  | 'failed'
  | 'planned'
  | 'skipped'
  | 'unchanged'

export interface TrustedPublisherResult {
  crate: string
  detail?: string | undefined
  status: TrustedPublisherStatus
}

export interface TrustedPublisherArgs {
  apply: boolean
  crates: string[]
  environment?: string | undefined
  // The `--path <dir>` checkout override, exactly as typed (absolute or
  // relative); `resolveInspectedRoot` resolves it against the caller's cwd.
  path?: string | undefined
  // The `--repo <owner/name>` GitHub slug the stored config names.
  repo?: string | undefined
  workflow?: string | undefined
}

export interface WorkflowSurface {
  environment?: string | undefined
  workflowFilename: string
}

export interface RunTrustedPublisherOptions {
  // Lists a crate's stored configs. Injected in tests so no network call
  // happens.
  listConfigs?:
    | ((crate: string, token: string) => Promise<GitHubConfigRow[]>)
    | undefined
  // Creates one config. Injected in tests for the same reason.
  createConfig?:
    | ((
        crate: string,
        target: TrustedPublisherTarget,
        token: string,
      ) => Promise<GitHubConfigRow>)
    | undefined
}

/**
 * Unwrap a YAML `environment:` value into the environment NAME. Handles the
 * three shapes a fleet workflow uses: a plain scalar (`cargo-publish`), a
 * quoted scalar, and the conditional expression
 * `${{ inputs.publish == true && 'cargo-publish' || '' }}` — whose environment
 * is the first NON-EMPTY quoted literal (the empty literal is the ungated
 * dry-run arm). Returns undefined when no name can be read. Pure — exported
 * for tests.
 */
export function unwrapEnvironmentValue(rawValue: string): string | undefined {
  const raw = rawValue.trim()
  if (raw === '' || raw.startsWith('#')) {
    return undefined
  }
  if (raw.startsWith('${{')) {
    // Every single- or double-quoted literal in the expression, in order. The
    // body of each holds no quote of its own kind, which is all a workflow
    // environment expression ever contains.
    const literals = raw.match(/'[^']*'|"[^"]*"/g) ?? []
    for (let i = 0, { length } = literals; i < length; i += 1) {
      const body = literals[i]!.slice(1, -1).trim()
      if (body !== '') {
        return body
      }
    }
    return undefined
  }
  // A quoted scalar with an optional trailing `# comment`. The back-reference
  // keeps the closing quote the same kind as the opening one.
  const quoted = /^(?<quote>['"])(?<body>.*)\k<quote>[ \t]*(?:#.*)?$/.exec(raw)
  if (quoted) {
    const body = (quoted.groups?.['body'] ?? '').trim()
    return body === '' ? undefined : body
  }
  // A plain scalar, dropping any trailing ` # comment`.
  const plain = raw.replace(/[ \t]+#.*$/, '').trim()
  return plain === '' ? undefined : plain
}

/**
 * The CI environment a workflow's job runs in, read from its first
 * job-level `environment:` key. Accepts the inline form
 * (`environment: cargo-publish`, quoted or a `${{ … }}` expression) and the
 * block form (`environment:` then a more-indented `name: cargo-publish`).
 * Returns undefined when the workflow gates on no environment. Pure —
 * exported for tests.
 */
export function extractWorkflowEnvironment(
  workflowText: string,
): string | undefined {
  const lines = workflowText.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    // The `environment:` key with its indent and whatever follows on the line.
    const keyMatch = /^(?<indent>[ \t]*)environment:(?<rest>.*)$/.exec(
      lines[i]!,
    )
    if (!keyMatch) {
      continue
    }
    const inline = unwrapEnvironmentValue(keyMatch.groups?.['rest'] ?? '')
    if (inline !== undefined) {
      return inline
    }
    // Block form: scan the more-indented lines beneath the key for `name:`,
    // stopping as soon as the indent returns to the key's level or shallower.
    const indent = (keyMatch.groups?.['indent'] ?? '').length
    for (let j = i + 1; j < length; j += 1) {
      const next = lines[j]!
      if (next.trim() === '') {
        continue
      }
      if (next.length - next.trimStart().length <= indent) {
        break
      }
      // The `name:` child key of an `environment:` block.
      const nameMatch = /^[ \t]*name:(?<value>.*)$/.exec(next)
      if (nameMatch) {
        return unwrapEnvironmentValue(nameMatch.groups?.['value'] ?? '')
      }
    }
  }
  return undefined
}

/**
 * The cargo-publish workflow basename among `filenames`, or undefined when the
 * repo has none. Sorted so the choice is deterministic when a repo somehow
 * carries both the `.yml` and `.yaml` spelling. Pure — exported for tests.
 */
export function pickCargoPublishWorkflow(
  filenames: readonly string[],
): string | undefined {
  return filenames
    .filter(f => CARGO_PUBLISH_WORKFLOW_BASENAMES.includes(f))
    .toSorted()[0]
}

/**
 * Whether `filename` is storable as a crates.io `workflow_filename`, mirroring
 * the registry's own validator: non-empty, at most 255 characters, a `.yml` or
 * `.yaml` suffix, and a BASENAME (no `/`). Pure — exported for tests.
 */
export function isValidWorkflowFilename(filename: string): boolean {
  if (filename.length === 0 || filename.length > 255) {
    return false
  }
  if (!filename.endsWith('.yml') && !filename.endsWith('.yaml')) {
    return false
  }
  return !filename.includes('/')
}

/**
 * A one-line problem with an environment NAME, or undefined when it is
 * storable. Mirrors the registry's validator: non-empty, at most 255
 * characters, no leading/trailing whitespace, and none of the control
 * characters or punctuation in REJECTED_ENVIRONMENT_CHARS. Pure — exported for
 * tests.
 */
export function environmentProblem(environment: string): string | undefined {
  if (environment.length === 0) {
    return 'is empty (omit it instead to configure an ungated publish)'
  }
  if (environment.length > 255) {
    return 'is longer than 255 characters'
  }
  if (environment.trimStart() !== environment) {
    return 'starts with whitespace'
  }
  if (environment.trimEnd() !== environment) {
    return 'ends with whitespace'
  }
  for (let i = 0, { length } = environment; i < length; i += 1) {
    const code = environment.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      return 'contains a control character'
    }
    if (REJECTED_ENVIRONMENT_CHARS.includes(environment[i]!)) {
      return `contains ${environment[i]}, which crates.io rejects`
    }
  }
  return undefined
}

/**
 * Whether a stored config already IS the desired target — same repo, workflow,
 * and environment. crates.io stores an ungated publish as `null`, which this
 * treats as equal to an undefined desired environment. Pure — exported for
 * tests.
 */
export function matchesTarget(
  row: GitHubConfigRow,
  target: TrustedPublisherTarget,
): boolean {
  const storedEnvironment = row.environment ?? undefined
  return (
    row.repository_owner === target.repositoryOwner &&
    row.repository_name === target.repositoryName &&
    row.workflow_filename === target.workflowFilename &&
    storedEnvironment === target.environment
  )
}

/**
 * A stored config rendered for the plan output. Pure — exported for tests.
 */
export function formatConfig(
  crate: string,
  target: TrustedPublisherTarget,
): string {
  const environment = target.environment ?? '(none)'
  return (
    `${crate} → ${target.repositoryOwner}/${target.repositoryName} ` +
    `· ${target.workflowFilename} · environment ${environment}`
  )
}

/**
 * The `detail` string crates.io puts in its `{ "errors": [{ "detail": … }] }`
 * error body, or undefined when the body is not that shape. Pure — exported
 * for tests.
 */
export function extractCratesIoErrorDetail(
  bodyText: string,
): string | undefined {
  let parsed: {
    errors?: Array<{ detail?: unknown | undefined }> | undefined
  }
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated boundary
    parsed = JSON.parse(bodyText) as typeof parsed
  } catch {
    return undefined
  }
  const detail = parsed.errors?.[0]?.detail
  return typeof detail === 'string' && detail ? detail : undefined
}

/**
 * Turn a crates.io HTTP failure into an actionable one-liner: What went wrong,
 * what the registry said, and the fix. The 403s are the ones worth naming —
 * crates.io returns the same status for "no token reached us" and "your token
 * lacks the trusted-publishing scope", and only the second is fixable by
 * minting a new token. Pure — exported for tests.
 */
export function describeHttpFailure(
  status: number,
  detail: string | undefined,
): string {
  const said = detail ?? `HTTP ${status}`
  if (status === 403 && detail?.includes('required permissions')) {
    return (
      `crates.io refused the token: ${said}. Fix: mint a token at ` +
      'crates.io/settings/tokens with the `trusted-publishing` scope (and a ' +
      'crate scope covering this crate), then re-run.'
    )
  }
  if (status === 401 || status === 403) {
    return (
      `crates.io refused the request: ${said}. Fix: confirm ` +
      'CARGO_REGISTRY_TOKEN (or ~/.cargo/credentials.toml) holds a current ' +
      'crates.io token with the `trusted-publishing` scope.'
    )
  }
  if (status === 400) {
    return (
      `crates.io rejected the request: ${said}. Fix: confirm the crate exists ` +
      'and that the token owner is an owner of it.'
    )
  }
  if (status === 404) {
    return (
      `crates.io has no such crate: ${said}. Fix: reserve the name first ` +
      '(scripts/socket-release/publish-infra/cargo/placeholder.mts), then configure ' +
      'the trusted publisher.'
    )
  }
  if (status === 429) {
    return `crates.io rate-limited the request: ${said}. Fix: wait, re-run.`
  }
  return `crates.io returned HTTP ${status}: ${said}`
}

/**
 * @file The ONE shape for prompting the human when an automated flow reaches
 *   a gate only they can clear: browser auth, a 2FA challenge, a hook
 *   authorization phrase, a staged-publish approve. Improvised asks made the
 *   operator re-parse a novel prompt every time; this module fixes the shape
 *   so every gate reads identically:
 *   🖐  HUMAN GATE — <name> [i/N]
 *   Need: <what is blocked and why, one sentence>
 *   Mind: <the active guard/tool restriction that shaped the lanes>
 *   A) You: <the exact command or phrase the human runs or types>
 *   B) Me: <what to say so the agent drives the SAME command>
 *   Then: <what the flow resumes once the gate clears>
 *   Both lanes are ALWAYS printed. When no agent lane exists (authorization
 *   phrases count only when a human types them in a user turn), lane B says
 *   so honestly instead of vanishing — the operator should never wonder
 *   whether an option was omitted or forgotten. Lanes run the SAME
 *   non-interactive-capable command (a router that passes through on a real
 *   TTY and runs under a PTY without one) so no gate ever juggles "that
 *   won't work here, do this instead". Pure formatting plus a catalog of
 *   the canonical gates, so scripts compose gates from data instead of
 *   re-writing the prose; a mirror test asserts the shape.
 */

/**
 * A single human-only decision point in an otherwise scripted flow.
 */
export interface HumanGate {
  /**
   * Short scannable label, e.g. `npm auth`, `push grant`.
   */
  name: string
  /**
   * What is blocked and why — one sentence.
   */
  need: string
  /**
   * Lane A: the exact command/phrase the human runs or types themselves.
   */
  humanLane: string
  /**
   * Lane B: what the human says to have the agent drive it (the agent opens
   * their browser and waits). Undefined when no agent lane can exist; then
   * `agentLaneUnavailable` must say why.
   */
  agentLane?: string | undefined
  /**
   * Honest reason lane B is absent — printed in its place, never omitted.
   */
  agentLaneUnavailable?: string | undefined
  /**
   * The active guard or restriction that shapes the lanes (devEngines veto,
   * no-TTY `!` input, sanctioned-browser law, phrase provenance). Printed so
   * the operator never picks a lane a guard would block.
   */
  mind?: string | undefined
  /**
   * What resumes once the gate clears — the cost of ignoring it.
   */
  resumes: string
}

/**
 * Render one gate in the canonical shape. `index`/`total` (1-based) chain
 * multiple gates into a numbered queue so the operator sees the whole path
 * to unblocked, not one ask at a time.
 */
export function formatHumanGate(
  gate: HumanGate,
  options?:
    | { index?: number | undefined; total?: number | undefined }
    | undefined,
): string[] {
  const opts = { __proto__: null, ...options } as {
    index?: number | undefined
    total?: number | undefined
  }
  const position =
    opts.index && opts.total ? ` [${opts.index}/${opts.total}]` : ''
  const laneB =
    gate.agentLane ??
    `no agent lane — ${gate.agentLaneUnavailable ?? 'this step is human-only'}`
  const lines = [
    `🖐  HUMAN GATE — ${gate.name}${position}`,
    `  Need: ${gate.need}`,
  ]
  if (gate.mind) {
    lines.push(`  Mind: ${gate.mind}`)
  }
  lines.push(
    `  A) You: ${gate.humanLane}`,
    `  B) Me: ${laneB}`,
    `  Then: ${gate.resumes}`,
  )
  return lines
}

/**
 * Render a queue of gates, numbered in the order they must clear.
 */
export function formatHumanGateQueue(gates: HumanGate[]): string[] {
  const lines: string[] = []
  for (let i = 0, { length } = gates; i < length; i += 1) {
    if (i > 0) {
      lines.push('')
    }
    lines.push(...formatHumanGate(gates[i]!, { index: i + 1, total: length }))
  }
  return lines
}

/**
 * Canonical gate: local npm auth is missing or expired (whoami 401). Both
 * lanes run the SAME command — the fleet auth router, which picks the tool
 * that survives each context (pnpm's web-OAuth login when available, npm
 * behind a PTY otherwise) — so there is never a mid-flight "that won't work,
 * do this instead". Only the runner differs: the operator's terminal, or the
 * agent through the PTY wrapper. The command is cd-anchored to a repo that
 * HAS the router: a bare relative path runs against whatever cwd the
 * operator's shell or the `!` in-session input happens to be in, and dies
 * MODULE_NOT_FOUND anywhere else.
 */
export function npmAuthGate(repoPath: string, resumes: string): HumanGate {
  const command = `cd ${repoPath} && node scripts/socket-release/npm-web-auth.mts login`
  return {
    agentLane:
      `say "log me in" and I run \`${command}\` through its PTY — ` +
      'your browser opens for the OAuth + OTP, I wait.',
    humanLane: `run \`${command}\` in your terminal — same flow, you drive.`,
    mind:
      'raw `npm login` dies without a TTY (legacy Username prompt EOFs) and ' +
      'bare `npm` fails in-repo (devEngines pins pnpm); the router carries ' +
      'both limitations so neither lane can hit them.',
    name: 'npm auth',
    need: 'the local npm token is missing or expired (`npm whoami` → 401).',
    resumes,
  }
}

/**
 * Canonical gate: a guarded push needs its authorization phrase. Phrases are
 * human-only artifacts — the scanner matches transcript role provenance, so
 * there is no agent lane by design.
 */
export function pushGrantGate(
  phrase: string,
  what: string,
  resumes: string,
): HumanGate {
  return {
    agentLaneUnavailable:
      'authorization phrases count only when a human types them in a user turn.',
    humanLane: `type exactly: ${phrase}`,
    mind:
      'the guard scans transcript role provenance — the phrase works typed ' +
      'here as a normal message, nothing to run.',
    name: 'push grant',
    need: `${what} is queued behind a push guard.`,
    resumes,
  }
}

/**
 * Canonical gate: promote a staged publish. Same command both lanes — the
 * approve pipeline already routes stage ops through pnpm and the promotion
 * through npm behind a PTY, so it survives the agent's TTY-less context and
 * the operator's terminal alike. The 2FA challenge lands in the operator's
 * browser either way: the agent can drive, only the human authenticates.
 */
export function approveGate(
  approveCommand: string,
  repoPath: string,
  resumes: string,
): HumanGate {
  return {
    agentLane:
      'say "run the approve" and I run the same command through its PTY — ' +
      'the 2FA challenge opens in your browser, everything else is scripted.',
    humanLane: `run \`cd ${repoPath} && ${approveCommand}\` — it prompts your 2FA.`,
    mind:
      'staged entries are maintainer-visible only — pnpm and npm can hold ' +
      'DIFFERENT accounts, and a wrong or missing login reads as an empty ' +
      'stage list, not an error; the pipeline identity-checks first.',
    name: 'publish approve',
    need: 'a staged publish is byte-verified and waiting on promotion.',
    resumes,
  }
}

/**
 * Canonical gate: a browser-session step (Playwright driver read/apply, a
 * profile sign-in) that needs the operator's window state or presence.
 */
export function browserSessionGate(
  need: string,
  humanLane: string,
  agentLane: string,
  resumes: string,
): HumanGate {
  return {
    agentLane,
    humanLane,
    mind:
      'only the sanctioned browser-session driver launches the profile — ' +
      'no scripted logins ever, and a Cloudflare challenge means pause for ' +
      'you, never retry.',
    name: 'browser session',
    need,
    resumes,
  }
}

/**
 * Kit gate: consent to burn a version. Publishing `<pkg>@0.0.0` is the one
 * irreversible act in the bootstrap — the version is burned forever and
 * unpublish closes after 72h — so no default `--apply` run performs it. Both
 * lanes run the SAME bootstrap command; only the runner differs.
 */
export function reserveNameGate(
  pkg: string,
  access: string,
  resumes: string,
): HumanGate {
  return {
    agentLane:
      'say "reserve the name" and I run ' +
      `\`node scripts/socket-release/bootstrap.mts placeholder --apply --reserve ${pkg}\` ` +
      "through its PTY — npm's web-2FA opens in your browser, I wait.",
    humanLane: `run \`node scripts/socket-release/bootstrap.mts placeholder --apply --reserve ${pkg}\` yourself.`,
    mind:
      `publishing ${pkg}@0.0.0 is irreversible — the version is burned forever and unpublish closes after 72h — ` +
      'so no default run performs it; --reserve must name the exact package.',
    name: 'reserve name',
    need: `${pkg} is unclaimed on npm; reserving it publishes a real 0.0.0 placeholder (access ${access}).`,
    resumes,
  }
}

/**
 * Kit gate: a staged placeholder is byte-live on the stage but not yet a
 * public version — only the operator's 2FA promote makes the name resolve.
 * Both lanes drive the SAME approve pipeline; the browser 2FA is the human
 * part either way.
 */
export function placeholderPromoteGate(
  pkg: string,
  stageId: string,
  resumes: string,
): HumanGate {
  return {
    agentLane:
      'say "promote the placeholder" and I run ' +
      '`node scripts/socket-release/npm-publish.mts --approve` through its ' +
      'PTY — the 2FA challenge opens in your browser, I wait.',
    humanLane:
      'run `node scripts/socket-release/npm-publish.mts --approve` — it ' +
      `promotes staged entry ${stageId} and prompts your 2FA.`,
    mind:
      'staged entries are maintainer-visible only — an unauthenticated or ' +
      'wrong-account stage list reads as EMPTY, not as an error; the approve ' +
      'pipeline identity-checks first.',
    name: 'placeholder promote',
    need: `${pkg}@0.0.0 is staged (${stageId}) and waiting on promotion before the name resolves as live.`,
    resumes,
  }
}

/**
 * Kit gate: npm's web-2FA approval page is open and holding a live URL —
 * the command is already running and waits on the operator's click. There is
 * no separate agent command to run: the PTY holds the flow either way.
 */
export function webAuthApproveGate(what: string, resumes: string): HumanGate {
  return {
    agentLane:
      'nothing extra to run — the PTY already holds the flow; tell me when ' +
      'the browser approval is done and I keep waiting for the exit.',
    humanLane:
      'open the APPROVE HERE url printed above in your browser and approve ' +
      '(expires in minutes) — tick the cooldown box so follow-up writes ride ' +
      'the same window.',
    mind:
      "npm's web-2FA URLs are single-use and short-lived; the waiting " +
      'command must stay alive through the approval — killing it voids the URL.',
    name: 'web-auth approve',
    need: `${what} is waiting on npm's web-2FA approval in your browser.`,
    resumes,
  }
}

/**
 * Kit gate: the GitHub environment API refused (HTTP 403 — a permissions
 * boundary, typically fine-grained token scopes or org policy). The API lane
 * is always tried FIRST; this gate is the browser fallback, and it is gate
 * TEXT only — no tool ever drives github.com.
 */
export function ghEnvGate(
  slug: string,
  env: string,
  resumes: string,
): HumanGate {
  const command = `gh api -X PUT repos/${slug}/environments/${env} -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'`
  return {
    agentLane:
      `say "retry the environment" and I re-run \`${command}\` — if your gh ` +
      'auth or org policy changed, the API lane succeeds and no browser is needed.',
    humanLane:
      `open https://github.com/${slug}/settings/environments , click "New environment", ` +
      `name it "${env}", then under Deployment branches choose "Selected branches" ` +
      'and add the default branch — or fix the token scope and run ' +
      `\`${command}\` yourself.`,
    mind:
      'no tool drives github.com in a browser — the settings URL is a human ' +
      'path only; the API lane (`gh api`) is always the first choice.',
    name: 'github environment',
    need: `GitHub refused environment writes on ${slug} (HTTP 403) while standing up "${env}".`,
    resumes,
  }
}

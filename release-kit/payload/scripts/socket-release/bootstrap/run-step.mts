/* eslint-disable socket/prefer-undefined-over-null -- JSON null sentinel */

import { errorMessage } from '@socketsecurity/lib/errors/message'

import { npmAuthGate } from '../_shared/human-gate.mts'
import type { StepContext, StepDetection } from './plan.mts'
import { gateToJson, KitError } from './render.mts'
import type { RunJson, StepOutcomeJson } from './render.mts'
import type { BootstrapSeams } from './seams.mts'
import type { StepShape } from './step-registry.mts'

export interface RunStepOutcome extends StepOutcomeJson {
  usageExit?: boolean | undefined
}

// oxlint-disable-next-line eslint/complexity -- branch dispatcher
export async function runStep(
  mod: StepShape,
  ctx: StepContext,
  seams: BootstrapSeams,
  mode: RunJson['mode'],
): Promise<RunStepOutcome> {
  const base: RunStepOutcome = {
    already: false,
    checks: [],
    detail: '',
    durationMs: 0,
    effects: [],
    gate: null,
    status: 'planned',
    step: mod.id,
  }
  let detection: StepDetection
  try {
    const inputs = await mod.read(ctx, seams)
    detection = mod.classify(inputs, ctx)
  } catch (e) {
    if (e instanceof KitError) {
      throw e
    }
    return {
      ...base,
      detail: `read failed: ${errorMessage(e)}`,
      status: 'failed',
    }
  }
  base.checks = detection.checks
  base.detail = detection.detail
  if (detection.done) {
    return { ...base, already: true, status: 'passed' }
  }
  if (detection.gate) {
    return { ...base, gate: gateToJson(detection.gate), status: 'blocked' }
  }
  if (detection.authUnknown) {
    if (mode === 'apply') {
      return {
        ...base,
        gate: gateToJson(
          npmAuthGate(ctx.repoRoot, `the bootstrap resumes at ${mod.id}.`),
        ),
        status: 'blocked',
      }
    }
    return { ...base, status: 'planned' }
  }
  if (detection.failed) {
    if (mode === 'apply' || detection.hardFail) {
      return { ...base, status: 'failed' }
    }
    return { ...base, status: 'planned' }
  }
  const stepPlan = mod.plan(detection, ctx)
  if (stepPlan.usage) {
    return {
      ...base,
      detail: `--reserve does not name the package: saw ${stepPlan.usage.saw}, wanted ${stepPlan.usage.wanted}.`,
      status: 'failed',
      usageExit: true,
    }
  }
  if (mode !== 'apply') {
    return { ...base, effects: stepPlan.effects, status: 'planned' }
  }
  if (stepPlan.gate) {
    return {
      ...base,
      effects: stepPlan.effects,
      gate: gateToJson(stepPlan.gate),
      status: 'blocked',
    }
  }
  const applied = await mod.apply(stepPlan, ctx, seams)
  if (applied.gate) {
    return {
      ...base,
      effects: applied.effects,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated boundary
      gate: gateToJson(applied.gate as never),
      status: 'blocked',
    }
  }
  let reDetection: StepDetection
  try {
    const reInputs = await mod.read(ctx, seams)
    reDetection = mod.classify(reInputs, ctx)
  } catch (e) {
    return {
      ...base,
      detail: `post-apply re-read failed: ${errorMessage(e)}`,
      effects: applied.effects,
      status: 'failed',
    }
  }
  base.checks = reDetection.checks
  if (reDetection.done) {
    return {
      ...base,
      detail: reDetection.detail,
      effects: applied.effects,
      status: 'passed',
    }
  }
  if (reDetection.gate) {
    return {
      ...base,
      detail: reDetection.detail,
      effects: applied.effects,
      gate: gateToJson(reDetection.gate),
      status: 'blocked',
    }
  }
  return {
    ...base,
    detail:
      applied.effects.length > 0
        ? `saved-state unproven: the post-apply re-read reports "${reDetection.detail}" — success is the registry's answer, never the command's exit code.`
        : reDetection.detail,
    effects: applied.effects,
    status: 'failed',
  }
}

/* eslint-enable socket/prefer-undefined-over-null */

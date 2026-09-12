import type { RunJson } from './render.mts'
import type { StepContext, StepDetection, StepId, StepPlan } from './plan.mts'
import type { BootstrapSeams } from './seams.mts'
import {
  apply as applyGithubEnv,
  classify as classifyGithubEnv,
  id as idGithubEnv,
  plan as planGithubEnv,
  read as readGithubEnv,
} from './steps/github-env.mts'
import {
  apply as applyNpmAccessPermissive,
  classify as classifyNpmAccessPermissive,
  id as idNpmAccessPermissive,
  plan as planNpmAccessPermissive,
  read as readNpmAccessPermissive,
} from './steps/npm-access-permissive.mts'
import {
  apply as applyNpmAccessStagedOnly,
  classify as classifyNpmAccessStagedOnly,
  id as idNpmAccessStagedOnly,
  plan as planNpmAccessStagedOnly,
  read as readNpmAccessStagedOnly,
} from './steps/npm-access-staged-only.mts'
import {
  apply as applyPlaceholder,
  classify as classifyPlaceholder,
  id as idPlaceholder,
  plan as planPlaceholder,
  read as readPlaceholder,
} from './steps/placeholder.mts'
import {
  apply as applyPreflight,
  classify as classifyPreflight,
  id as idPreflight,
  plan as planPreflight,
  read as readPreflight,
} from './steps/preflight.mts'
import {
  apply as applyStagedConfig,
  classify as classifyStagedConfig,
  id as idStagedConfig,
  plan as planStagedConfig,
  read as readStagedConfig,
} from './steps/staged-config.mts'
import {
  apply as applyTrustedPublisher,
  classify as classifyTrustedPublisher,
  id as idTrustedPublisher,
  plan as planTrustedPublisher,
  read as readTrustedPublisher,
} from './steps/trusted-publisher.mts'
import {
  apply as applyVerify,
  classify as classifyVerify,
  id as idVerify,
  plan as planVerify,
  read as readVerify,
} from './steps/verify.mts'

export interface StepShape {
  readonly __proto__: null
  apply(
    plan: StepPlan,
    ctx: StepContext,
    seams: BootstrapSeams,
  ): Promise<{
    effects: RunJson['steps'][number]['effects']
    gate?: unknown | undefined
  }>
  classify(inputs: unknown, ctx: StepContext): StepDetection
  id: StepId
  plan(detection: StepDetection, ctx: StepContext): StepPlan
  read(ctx: StepContext, seams: BootstrapSeams): Promise<unknown>
}

export const STEP_MODULES: Record<StepId, StepShape> = {
  'github-env': {
    __proto__: null,
    apply: applyGithubEnv,
    classify: classifyGithubEnv,
    id: idGithubEnv,
    plan: planGithubEnv,
    read: readGithubEnv,
  },
  'npm-access-permissive': {
    __proto__: null,
    apply: applyNpmAccessPermissive,
    classify: classifyNpmAccessPermissive,
    id: idNpmAccessPermissive,
    plan: planNpmAccessPermissive,
    read: readNpmAccessPermissive,
  },
  'npm-access-staged-only': {
    __proto__: null,
    apply: applyNpmAccessStagedOnly,
    classify: classifyNpmAccessStagedOnly,
    id: idNpmAccessStagedOnly,
    plan: planNpmAccessStagedOnly,
    read: readNpmAccessStagedOnly,
  },
  placeholder: {
    __proto__: null,
    apply: applyPlaceholder,
    classify: classifyPlaceholder,
    id: idPlaceholder,
    plan: planPlaceholder,
    read: readPlaceholder,
  },
  preflight: {
    __proto__: null,
    apply: applyPreflight,
    classify: classifyPreflight,
    id: idPreflight,
    plan: planPreflight,
    read: readPreflight,
  },
  'staged-config': {
    __proto__: null,
    apply: applyStagedConfig,
    classify: classifyStagedConfig,
    id: idStagedConfig,
    plan: planStagedConfig,
    read: readStagedConfig,
  },
  'trusted-publisher': {
    __proto__: null,
    apply: applyTrustedPublisher,
    classify: classifyTrustedPublisher,
    id: idTrustedPublisher,
    plan: planTrustedPublisher,
    read: readTrustedPublisher,
  },
  verify: {
    __proto__: null,
    apply: applyVerify,
    classify: classifyVerify,
    id: idVerify,
    plan: planVerify,
    read: readVerify,
  },
}

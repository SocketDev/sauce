import type { StageListEntry } from './shared.mts'
import { formatPriorProvenance } from './shared.mts'

export interface ApproveChoice {
  checked: boolean
  name: string
  value: string
}

/**
 * Build the checkbox choices for the approve multi-select: one row per eligible
 * staged entry, labelled `name@version` with the prior-provenance annotation,
 * valued by its stageId, pre-checked so the default is "approve all". Pure over
 * the eligible list + the prior-provenance map.
 */
export function buildApproveChoices(
  eligible: readonly StageListEntry[],
  priorProvenance: ReadonlyMap<string, boolean>,
): ApproveChoice[] {
  return eligible.map(e => ({
    __proto__: null,
    checked: true,
    name: `${e.name}@${e.version}${formatPriorProvenance(priorProvenance.get(e.name!))}`,
    value: e.stageId!,
  }))
}

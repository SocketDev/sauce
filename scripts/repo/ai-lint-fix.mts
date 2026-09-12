#!/usr/bin/env node
/**
 * @file Thin entry shim — real CLI lives in ai-lint-fix/cli.mts. Rule data
 *   (AI_HANDLED_RULES + RULE_GUIDANCE) lives in ai-lint-fix/rule-guidance.mts
 *   so the prompt corpus can be reviewed / extended without touching the
 *   orchestrator.
 */

import { main, SCRIPT_META } from './ai-lint-fix/cli.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'

if (isMainModule(import.meta.url)) {
  runMain(() => main(), SCRIPT_META)
}

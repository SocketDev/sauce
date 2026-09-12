#!/usr/bin/env node
/**
 * @file Thin entry shim — real script lives in lockstep/emit-schema.mts.
 */

import { main, SCRIPT_META } from './lockstep/emit-schema.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'

if (isMainModule(import.meta.url)) {
  runMain(() => main(), SCRIPT_META)
}

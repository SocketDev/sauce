#!/usr/bin/env node
/**
 * @file Thin entry shim — real CLI lives in lockstep/cli.mts.
 */

import { main, SCRIPT_META } from './lockstep/cli.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'

if (isMainModule(import.meta.url)) {
  runMain(() => main(), SCRIPT_META)
}

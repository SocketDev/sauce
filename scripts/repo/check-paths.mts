#!/usr/bin/env node
/**
 * @file Thin entry shim — real CLI lives in check-paths/cli.mts.
 */

import { main, SCRIPT_META } from './check-paths/cli.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'

if (isMainModule(import.meta.url)) {
  runMain(() => main(), SCRIPT_META)
}

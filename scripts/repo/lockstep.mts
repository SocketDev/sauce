#!/usr/bin/env node
/**
 * @file Thin entry shim — real CLI lives in lockstep/cli.mts.
 */

import { main, SCRIPT_META } from './lockstep/cli.mts'
import { isMainModule, runMain } from './util/main.mts'

if (isMainModule(import.meta.url)) {
  runMain(() => main(), SCRIPT_META)
}

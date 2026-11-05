#!/usr/bin/env node
/**
 * @file Thin entry shim — real script lives in lockstep/emit-schema.mts.
 */

import { main, SCRIPT_META } from './lockstep/emit-schema.mts'
import { isMainModule, runMain } from './util/main.mts'

if (isMainModule(import.meta.url)) {
  runMain(() => main(), SCRIPT_META)
}

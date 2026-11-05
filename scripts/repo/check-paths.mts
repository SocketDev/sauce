#!/usr/bin/env node
/**
 * @file Thin entry shim — real CLI lives in check-paths/cli.mts.
 */

import { main, SCRIPT_META } from './check-paths/cli.mts'
import { isMainModule, runMain } from './util/main.mts'

if (isMainModule(import.meta.url)) {
  runMain(() => main(), SCRIPT_META)
}

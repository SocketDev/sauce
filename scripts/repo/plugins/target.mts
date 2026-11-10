/**
 * The contract every agent plugin implements. A target gets the shared
 * context (the plugin identity, every skill, the MCP server) and an
 * ArtifactWriter, and describes its own files. Adding an agent means adding
 * one module under targets/ and listing it in registry.mts.
 */

import type { ArtifactWriter } from './output.mts'
import type { Skill } from './skills.mts'
import type { PluginIdentity } from './socket.mts'

export interface PluginInputs {
  root: string
  identity: PluginIdentity
  skills: readonly Skill[]
}

export interface PluginContext extends PluginInputs {
  out: ArtifactWriter
}

/**
 * One row of the "how to sign in" table in the socket-connect skill.
 */
export interface SignInRow {
  /**
   * The agent label for this row; defaults to the target's agent.
   */
  agent?: string | undefined
  howTo: string
}

/**
 * How users of an agent connect it to the Socket MCP server.
 */
export interface AgentConnect {
  /**
   * Whether the agent's plugin registers the Socket MCP server itself.
   */
  bundlesServer: boolean
  /**
   * Rows for the sign-in table, in the order they should appear.
   */
  signIn: readonly SignInRow[]
  /**
   * When the agent's plugin does not register the server, or a user installs
   * skills without the plugin: one sentence and the command that adds it.
   */
  addServer?: { intro: string; command: string } | undefined
}

export interface PluginTarget {
  /**
   * Short stable id, used on the command line.
   */
  id: string
  /**
   * The agent's product name, as the README and docs spell it.
   */
  agent: string
  /**
   * Repo-relative files this target generates.
   */
  files: readonly string[]
  /**
   * Repo-relative directories this target generates wholesale.
   */
  dirs: readonly string[]
  /**
   * Hand-maintained repo-relative files the target reads or ships. Generation
   * fails if one is missing.
   */
  sources: readonly string[]
  /**
   * Repo-relative directories of agent instruction files (rules) the target
   * ships. Shared sections are inlined into them, and the shipped-content
   * scans cover them.
   */
  instructionDirs?: readonly string[] | undefined
  connect: AgentConnect
  generate(ctx: PluginContext): void
}

export function definePluginTarget(target: PluginTarget): PluginTarget {
  return target
}

import { Cli, z } from 'incur'
import { readState, readLocalState, readEnvState, mergeState, requireBrainjarDir } from '../state.js'
import { sync } from '../sync.js'

export const status = Cli.create('status', {
  description: 'Show active brain configuration',
  options: z.object({
    sync: z.boolean().default(false).describe('Regenerate config file from active layers'),
    global: z.boolean().default(false).describe('Show only global state'),
    local: z.boolean().default(false).describe('Show only local overrides'),
    short: z.boolean().default(false).describe('One-line output: soul | persona'),
  }),
  async run(c) {
    await requireBrainjarDir()

    // --short: compact one-liner for scripts/statuslines
    if (c.options.short) {
      const global = await readState()
      const local = await readLocalState()
      const env = readEnvState()
      const effective = mergeState(global, local, env)
      const parts = [
        `soul: ${effective.soul.value ?? 'none'}`,
        `persona: ${effective.persona.value ?? 'none'}`,
      ]
      return parts.join(' | ')
    }

    // Sync if requested
    let synced: Record<string, unknown> | undefined
    if (c.options.sync) {
      const syncResult = await sync()
      synced = { written: syncResult.written, warnings: syncResult.warnings }
    }

    // --global: show only global state (v0.1 behavior)
    if (c.options.global) {
      const state = await readState()
      const result: Record<string, unknown> = {
        soul: state.soul ?? null,
        persona: state.persona ?? null,
        rules: state.rules,
      }
      if (synced) result.synced = synced
      return result
    }

    // --local: show only local overrides
    if (c.options.local) {
      const local = await readLocalState()
      const result: Record<string, unknown> = {}
      if ('soul' in local) result.soul = local.soul
      if ('persona' in local) result.persona = local.persona
      if (local.rules) result.rules = local.rules
      if (Object.keys(result).length === 0) result.note = 'No local overrides'
      if (synced) result.synced = synced
      return result
    }

    // Default: effective state with scope annotations
    const global = await readState()
    const local = await readLocalState()
    const env = readEnvState()
    const effective = mergeState(global, local, env)

    // Agents and explicit --format get full structured data
    if (c.agent || c.formatExplicit) {
      const result: Record<string, unknown> = {
        soul: effective.soul,
        persona: effective.persona,
        rules: effective.rules,
      }
      if (synced) result.synced = synced
      return result
    }

    // Humans get a compact view with scope annotations
    const fmtScope = (scope: string) => `(${scope})`

    const rulesLabel = effective.rules.length
      ? effective.rules
          .filter(r => !r.scope.startsWith('-'))
          .map(r => `${r.value} ${fmtScope(r.scope)}`)
          .join(', ')
      : null

    const result: Record<string, unknown> = {
      soul: effective.soul.value ? `${effective.soul.value} ${fmtScope(effective.soul.scope)}` : null,
      persona: effective.persona.value ? `${effective.persona.value} ${fmtScope(effective.persona.scope)}` : null,
      rules: rulesLabel,
    }
    if (synced) result.synced = synced
    return result
  },
})

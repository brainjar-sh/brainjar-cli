import { Errors } from 'incur'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { paths } from './paths.js'
import { normalizeSlug } from './state.js'

const { IncurError } = Errors

/** Brain YAML schema: soul + persona + rules */
export interface BrainConfig {
  soul: string
  persona: string
  rules: string[]
}

/** Read and validate a brain YAML file. */
export async function readBrain(name: string): Promise<BrainConfig> {
  const slug = normalizeSlug(name, 'brain name')
  const file = join(paths.brains, `${slug}.yaml`)

  let raw: string
  try {
    raw = await readFile(file, 'utf-8')
  } catch {
    throw new IncurError({
      code: 'BRAIN_NOT_FOUND',
      message: `Brain "${slug}" not found.`,
      hint: 'Run `brainjar brain list` to see available brains.',
    })
  }

  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch (e) {
    throw new IncurError({
      code: 'BRAIN_CORRUPT',
      message: `Brain "${slug}" has invalid YAML: ${(e as Error).message}`,
    })
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new IncurError({
      code: 'BRAIN_CORRUPT',
      message: `Brain "${slug}" is empty or invalid.`,
    })
  }

  const p = parsed as Record<string, unknown>

  if (typeof p.soul !== 'string' || !p.soul) {
    throw new IncurError({
      code: 'BRAIN_INVALID',
      message: `Brain "${slug}" is missing required field "soul".`,
    })
  }

  if (typeof p.persona !== 'string' || !p.persona) {
    throw new IncurError({
      code: 'BRAIN_INVALID',
      message: `Brain "${slug}" is missing required field "persona".`,
    })
  }

  const rules = Array.isArray(p.rules) ? p.rules.map(String) : []

  return { soul: p.soul, persona: p.persona, rules }
}

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { reset } from '../../src/commands/reset.js'
import {
  startMockServer, stopMockServer, restoreGlobalEnv,
  setup, teardown, run, backendDir,
} from './_helpers.js'

beforeAll(startMockServer)
afterAll(() => { stopMockServer(); restoreGlobalEnv() })

describe('reset command', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('removes brainjar markers and preserves user content', async () => {
    // backendDir is re-assigned each setup(), need dynamic import
    const { backendDir: dir } = await import('./_helpers.js')
    const configDir = join(dir, '.claude')
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, 'CLAUDE.md'),
      'user content\n\n<!-- brainjar:start -->\n# managed\n<!-- brainjar:end -->\n\nmore user content\n'
    )

    const { parsed } = await run(reset, ['--backend', 'claude', '--format', 'json'])
    expect(parsed.removed).toBe(true)

    const remaining = await readFile(join(configDir, 'CLAUDE.md'), 'utf-8')
    expect(remaining).toContain('user content')
    expect(remaining).toContain('more user content')
    expect(remaining).not.toContain('brainjar:start')
    expect(remaining).not.toContain('# managed')
  })

  test('restores backup when only brainjar content remains', async () => {
    const { backendDir: dir } = await import('./_helpers.js')
    const configDir = join(dir, '.claude')
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, 'CLAUDE.md'),
      '<!-- brainjar:start -->\n# managed\n<!-- brainjar:end -->\n'
    )
    await writeFile(join(configDir, 'CLAUDE.md.pre-brainjar'), '# Original user config\n')

    const { parsed } = await run(reset, ['--backend', 'claude', '--format', 'json'])
    expect(parsed.removed).toBe(true)
    expect(parsed.restored).toBe(true)

    const restored = await readFile(join(configDir, 'CLAUDE.md'), 'utf-8')
    expect(restored).toContain('# Original user config')
  })

  test('returns removed=false when no markers found', async () => {
    const { parsed } = await run(reset, ['--backend', 'claude', '--format', 'json'])
    expect(parsed.removed).toBe(false)
  })
})

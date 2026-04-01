import { describe, test, expect, afterEach, beforeAll, afterAll } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { init } from '../../src/commands/init.js'
import {
  startMockServer, stopMockServer, restoreGlobalEnv, resetStore,
  teardown, run,
} from './_helpers.js'

let brainjarDir: string
let backendDir: string
let origCwd: string

const envKeys = ['BRAINJAR_SOUL', 'BRAINJAR_PERSONA', 'BRAINJAR_RULES_ADD', 'BRAINJAR_RULES_REMOVE']
const savedEnv: Record<string, string | undefined> = {}

beforeAll(startMockServer)
afterAll(() => { stopMockServer(); restoreGlobalEnv() })

describe('init command', () => {
  afterEach(async () => {
    // Use the same teardown pattern but with local vars
    process.chdir(origCwd)
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) process.env[key] = savedEnv[key]
      else delete process.env[key]
    }
    delete process.env.BRAINJAR_TEST_HOME
    delete process.env.BRAINJAR_LOCAL_DIR
    const { rm } = await import('node:fs/promises')
    await rm(brainjarDir, { recursive: true, force: true })
    await rm(backendDir, { recursive: true, force: true })
  })

  test('creates directory structure', async () => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    brainjarDir = await mkdtemp(join(tmpdir(), 'brainjar-init-'))
    backendDir = await mkdtemp(join(tmpdir(), 'brainjar-backend-'))
    process.env.BRAINJAR_HOME = brainjarDir
    process.env.BRAINJAR_TEST_HOME = backendDir
    origCwd = process.cwd()
    process.chdir(backendDir)

    await mkdir(brainjarDir, { recursive: true })
    const { mockServerUrl } = await import('./_helpers.js')
    await writeFile(
      join(brainjarDir, 'config.yaml'),
      `server:\n  url: ${mockServerUrl}\n  mode: remote\nworkspace: test\n`,
    )
    resetStore()

    const { parsed } = await run(init, ['--format', 'json'])
    expect(parsed.created).toBe(brainjarDir)
    expect(parsed.directories).toContain('souls/')

    await access(join(brainjarDir, 'souls'))
    await access(join(brainjarDir, 'personas'))
    await access(join(brainjarDir, 'rules'))

    const gitignore = await readFile(join(brainjarDir, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('state.yaml')
  })
})

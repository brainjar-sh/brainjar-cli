import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test'
import { upgrade } from '../../src/commands/upgrade.js'
import { ErrorCode } from '../../src/errors.js'
import {
  startMockServer, stopMockServer, restoreGlobalEnv,
  setup, teardown, run,
} from './_helpers.js'

beforeAll(startMockServer)
afterAll(() => { stopMockServer(); restoreGlobalEnv() })

describe('upgrade flags', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('rejects --cli-only and --server-only together', async () => {
    const { exitCode, parsed } = await run(upgrade, ['--cli-only', '--server-only', '--format', 'json'])
    expect(exitCode).toBe(1)
    expect(parsed.code).toBe(ErrorCode.MUTUALLY_EXCLUSIVE)
  })

  test('--cli-only upgrades only CLI', async () => {
    const { exitCode, parsed } = await run(upgrade, ['--cli-only', '--format', 'json'])
    expect(exitCode).toBeUndefined()
    expect(parsed.cli).toBeDefined()
    expect(parsed.cli.upgraded).toBe(false)
    expect(parsed.cli.message).toContain('Already on latest')
    expect(parsed.server).toBeUndefined()
  })
})

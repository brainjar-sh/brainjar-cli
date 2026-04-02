import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  getInstalledServerVersion,
  setInstalledServerVersion,
  installedVersionPath,
} from '../src/version-check.js'

const TEST_HOME = join(import.meta.dir, '..', '.test-home-version')

beforeEach(async () => {
  process.env.BRAINJAR_HOME = TEST_HOME
  await mkdir(TEST_HOME, { recursive: true })
})

afterEach(async () => {
  delete process.env.BRAINJAR_HOME
  await rm(TEST_HOME, { recursive: true, force: true })
})

describe('getInstalledServerVersion / setInstalledServerVersion', () => {
  test('returns null when no version file exists', async () => {
    const result = await getInstalledServerVersion()
    expect(result).toBeNull()
  })

  test('round-trips a version string', async () => {
    await setInstalledServerVersion('v0.1.0')
    const result = await getInstalledServerVersion()
    expect(result).toBe('v0.1.0')
  })

  test('trims whitespace', async () => {
    await writeFile(installedVersionPath(), '  v0.1.5\n')
    const result = await getInstalledServerVersion()
    expect(result).toBe('v0.1.5')
  })

  test('overwrites previous version', async () => {
    await setInstalledServerVersion('v0.1.0')
    await setInstalledServerVersion('v0.2.0')
    const result = await getInstalledServerVersion()
    expect(result).toBe('v0.2.0')
  })
})

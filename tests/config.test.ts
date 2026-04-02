import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readConfig, writeConfig, getConfigPath, activeContext, localContext, contextNameFromUrl, uniqueContextName } from '../src/config.js'

const TEST_HOME = join(import.meta.dir, '..', '.test-home-config')

beforeEach(async () => {
  process.env.BRAINJAR_TEST_HOME = TEST_HOME
  await mkdir(join(TEST_HOME, '.brainjar'), { recursive: true })

  // Clear env overrides
  delete process.env.BRAINJAR_SERVER_URL
  delete process.env.BRAINJAR_WORKSPACE
  delete process.env.BRAINJAR_BACKEND
})

afterEach(async () => {
  delete process.env.BRAINJAR_TEST_HOME
  delete process.env.BRAINJAR_SERVER_URL
  delete process.env.BRAINJAR_WORKSPACE
  delete process.env.BRAINJAR_BACKEND
  await rm(TEST_HOME, { recursive: true, force: true })
})

describe('readConfig', () => {
  test('returns defaults when file missing', async () => {
    const config = await readConfig()
    const ctx = activeContext(config)
    expect(ctx.url).toBe('http://localhost:7742')
    expect(ctx.mode).toBe('local')
    expect(ctx.workspace).toBe('default')
    expect(config.backend).toBe('claude')
    expect(config.version).toBe(2)
    expect(config.current_context).toBe('local')
  })

  test('reads v1 config and migrates', async () => {
    await writeFile(
      join(TEST_HOME, '.brainjar', 'config.yaml'),
      'server:\n  url: http://remote:9999\n  mode: remote\nworkspace: myteam\nbackend: codex\n',
    )
    const config = await readConfig()
    const ctx = activeContext(config)
    expect(ctx.url).toBe('http://remote:9999')
    expect(ctx.mode).toBe('remote')
    expect(ctx.workspace).toBe('myteam')
    expect(config.backend).toBe('codex')
    expect(config.version).toBe(2)
    // Local context should still exist
    expect(config.contexts.local).toBeDefined()
    expect(config.contexts.local.mode).toBe('local')
  })

  test('reads v2 config natively', async () => {
    await writeFile(
      join(TEST_HOME, '.brainjar', 'config.yaml'),
      `version: 2\ncurrent_context: staging\ncontexts:\n  local:\n    url: http://localhost:7742\n    mode: local\n    bin: /bin/server\n    pid_file: /pid\n    log_file: /log\n    workspace: default\n  staging:\n    url: https://staging.example.com\n    mode: remote\n    workspace: team\nbackend: claude\n`,
    )
    const config = await readConfig()
    expect(config.current_context).toBe('staging')
    const ctx = activeContext(config)
    expect(ctx.url).toBe('https://staging.example.com')
    expect(ctx.mode).toBe('remote')
    expect(ctx.workspace).toBe('team')
  })

  test('merges partial v1 config with defaults', async () => {
    await writeFile(
      join(TEST_HOME, '.brainjar', 'config.yaml'),
      'workspace: custom\n',
    )
    const config = await readConfig()
    const ctx = activeContext(config)
    expect(ctx.workspace).toBe('custom')
    expect(ctx.url).toBe('http://localhost:7742')
    expect(ctx.mode).toBe('local')
    expect(config.backend).toBe('claude')
  })

  test('throws on corrupt YAML', async () => {
    await writeFile(
      join(TEST_HOME, '.brainjar', 'config.yaml'),
      ':\n  - :\n  bad: [unclosed',
    )
    await expect(readConfig()).rejects.toThrow('config.yaml is corrupt')
  })

  test('ignores invalid mode in v1, falls back to default', async () => {
    await writeFile(
      join(TEST_HOME, '.brainjar', 'config.yaml'),
      'server:\n  mode: invalid\n',
    )
    const config = await readConfig()
    const ctx = activeContext(config)
    expect(ctx.mode).toBe('local')
  })

  test('ignores invalid backend, falls back to default', async () => {
    await writeFile(
      join(TEST_HOME, '.brainjar', 'config.yaml'),
      'backend: invalid\n',
    )
    const config = await readConfig()
    expect(config.backend).toBe('claude')
  })

  test('env var overrides active context values', async () => {
    await writeFile(
      join(TEST_HOME, '.brainjar', 'config.yaml'),
      'server:\n  url: http://file-url:1234\nworkspace: file-ws\nbackend: claude\n',
    )
    process.env.BRAINJAR_SERVER_URL = 'http://env-url:5678'
    process.env.BRAINJAR_WORKSPACE = 'env-ws'
    process.env.BRAINJAR_BACKEND = 'codex'

    const config = await readConfig()
    const ctx = activeContext(config)
    expect(ctx.url).toBe('http://env-url:5678')
    expect(ctx.workspace).toBe('env-ws')
    expect(config.backend).toBe('codex')
  })

  test('ignores invalid env backend', async () => {
    process.env.BRAINJAR_BACKEND = 'invalid'
    const config = await readConfig()
    expect(config.backend).toBe('claude')
  })

  test('ensures local context exists in v2 even if missing from file', async () => {
    await writeFile(
      join(TEST_HOME, '.brainjar', 'config.yaml'),
      `version: 2\ncurrent_context: remote-1\ncontexts:\n  remote-1:\n    url: https://example.com\n    mode: remote\n    workspace: default\nbackend: claude\n`,
    )
    const config = await readConfig()
    expect(config.contexts.local).toBeDefined()
    expect(config.contexts.local.mode).toBe('local')
  })

  test('falls back to local if current_context missing in v2', async () => {
    await writeFile(
      join(TEST_HOME, '.brainjar', 'config.yaml'),
      `version: 2\ncurrent_context: nonexistent\ncontexts:\n  local:\n    url: http://localhost:7742\n    mode: local\n    bin: /bin\n    pid_file: /pid\n    log_file: /log\n    workspace: default\nbackend: claude\n`,
    )
    const config = await readConfig()
    expect(config.current_context).toBe('local')
  })
})

describe('writeConfig', () => {
  test('writes v2 and reads back', async () => {
    const config = await readConfig()
    const ctx = activeContext(config)
    ctx.workspace = 'roundtrip'

    // Add a remote context and switch to it
    config.contexts.staging = { url: 'http://example.com:7742', mode: 'remote', workspace: 'roundtrip' }
    config.current_context = 'staging'

    await writeConfig(config)

    const reloaded = await readConfig()
    expect(reloaded.current_context).toBe('staging')
    const reloadedCtx = activeContext(reloaded)
    expect(reloadedCtx.mode).toBe('remote')
    expect(reloadedCtx.url).toBe('http://example.com:7742')
    expect(reloadedCtx.workspace).toBe('roundtrip')
    // Local still there
    expect(reloaded.contexts.local.mode).toBe('local')
  })

  test('creates directory if missing', async () => {
    await rm(join(TEST_HOME, '.brainjar'), { recursive: true, force: true })
    const config = await readConfig()
    await writeConfig(config)
    const raw = await readFile(join(TEST_HOME, '.brainjar', 'config.yaml'), 'utf-8')
    expect(raw).toContain('localhost')
    expect(raw).toContain('version: 2')
  })
})

describe('contextNameFromUrl', () => {
  test('derives name from hostname', () => {
    expect(contextNameFromUrl('https://staging.brainjar.sh')).toBe('staging-brainjar-sh')
    expect(contextNameFromUrl('http://localhost:7742')).toBe('localhost')
  })

  test('returns remote for invalid URL', () => {
    expect(contextNameFromUrl('not-a-url')).toBe('remote')
  })
})

describe('uniqueContextName', () => {
  test('returns base if not taken', () => {
    expect(uniqueContextName('staging', {})).toBe('staging')
  })

  test('appends suffix if taken', () => {
    expect(uniqueContextName('staging', { staging: true })).toBe('staging-2')
    expect(uniqueContextName('staging', { staging: true, 'staging-2': true })).toBe('staging-3')
  })
})

describe('getConfigPath', () => {
  test('returns path under brainjar dir', () => {
    expect(getConfigPath()).toBe(join(TEST_HOME, '.brainjar', 'config.yaml'))
  })
})

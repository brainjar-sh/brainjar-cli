import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test'
import { context } from '../../src/commands/context.js'
import { ErrorCode } from '../../src/errors.js'
import {
  startMockServer, stopMockServer, restoreGlobalEnv,
  setup, teardown, run,
} from './_helpers.js'

beforeAll(startMockServer)
afterAll(() => { stopMockServer(); restoreGlobalEnv() })

describe('context list', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('lists contexts with active marker', async () => {
    const { parsed } = await run(context, ['list', '--format', 'json'])
    expect(parsed.contexts).toBeArray()
    const local = parsed.contexts.find((c: any) => c.name === 'local')
    expect(local).toBeDefined()
  })
})

describe('context add', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('adds a remote context', async () => {
    const { mockServerUrl } = await import('./_helpers.js')
    const { exitCode, parsed } = await run(context, ['add', 'staging', mockServerUrl, '--format', 'json'])
    expect(exitCode).toBeUndefined()
    expect(parsed.added).toBe('staging')
    expect(parsed.url).toBe(mockServerUrl)
  })

  test('rejects duplicate name', async () => {
    const { mockServerUrl } = await import('./_helpers.js')
    await run(context, ['add', 'staging', mockServerUrl, '--format', 'json'])
    const { exitCode, parsed } = await run(context, ['add', 'staging', mockServerUrl, '--format', 'json'])
    expect(exitCode).toBe(1)
    expect(parsed.code).toBe(ErrorCode.CONTEXT_EXISTS)
  })

  test('rejects adding context named local', async () => {
    const { mockServerUrl } = await import('./_helpers.js')
    const { exitCode, parsed } = await run(context, ['add', 'local', mockServerUrl, '--format', 'json'])
    expect(exitCode).toBe(1)
    expect(parsed.code).toBe(ErrorCode.CONTEXT_PROTECTED)
  })

  test('rejects unreachable server', async () => {
    const { exitCode, parsed } = await run(context, ['add', 'dead', 'http://localhost:1', '--format', 'json'])
    expect(exitCode).toBe(1)
    expect(parsed.code).toBe(ErrorCode.SERVER_UNREACHABLE)
  })

  test('rejects invalid name', async () => {
    const { mockServerUrl } = await import('./_helpers.js')
    const { exitCode, parsed } = await run(context, ['add', 'bad name!', mockServerUrl, '--format', 'json'])
    expect(exitCode).toBe(1)
    expect(parsed.code).toBe(ErrorCode.VALIDATION_ERROR)
  })
})

describe('context remove', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('removes a context', async () => {
    const { mockServerUrl } = await import('./_helpers.js')
    await run(context, ['add', 'staging', mockServerUrl, '--format', 'json'])
    const { exitCode, parsed } = await run(context, ['remove', 'staging', '--format', 'json'])
    expect(exitCode).toBeUndefined()
    expect(parsed.removed).toBe('staging')
  })

  test('cannot remove local', async () => {
    const { exitCode, parsed } = await run(context, ['remove', 'local', '--format', 'json'])
    expect(exitCode).toBe(1)
    expect(parsed.code).toBe(ErrorCode.CONTEXT_PROTECTED)
  })

  test('cannot remove active context', async () => {
    const { mockServerUrl } = await import('./_helpers.js')
    await run(context, ['add', 'staging', mockServerUrl, '--format', 'json'])
    await run(context, ['use', 'staging', '--format', 'json'])
    const { exitCode, parsed } = await run(context, ['remove', 'staging', '--format', 'json'])
    expect(exitCode).toBe(1)
    expect(parsed.code).toBe(ErrorCode.CONTEXT_ACTIVE)
  })

  test('errors on nonexistent context', async () => {
    const { exitCode, parsed } = await run(context, ['remove', 'nope', '--format', 'json'])
    expect(exitCode).toBe(1)
    expect(parsed.code).toBe(ErrorCode.CONTEXT_NOT_FOUND)
  })
})

describe('context use', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('switches active context', async () => {
    const { mockServerUrl } = await import('./_helpers.js')
    await run(context, ['add', 'staging', mockServerUrl, '--format', 'json'])
    const { exitCode, parsed } = await run(context, ['use', 'staging', '--format', 'json'])
    expect(exitCode).toBeUndefined()
    expect(parsed.active).toBe('staging')
    expect(parsed.mode).toBe('remote')
  })

  test('errors on nonexistent context', async () => {
    const { exitCode, parsed } = await run(context, ['use', 'nope', '--format', 'json'])
    expect(exitCode).toBe(1)
    expect(parsed.code).toBe(ErrorCode.CONTEXT_NOT_FOUND)
  })
})

describe('context show', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('shows active context by default', async () => {
    const { exitCode, parsed } = await run(context, ['show', '--format', 'json'])
    expect(exitCode).toBeUndefined()
    expect(parsed.active).toBe(true)
  })

  test('shows named context', async () => {
    const { mockServerUrl } = await import('./_helpers.js')
    await run(context, ['add', 'staging', mockServerUrl, '--format', 'json'])
    const { exitCode, parsed } = await run(context, ['show', 'staging', '--format', 'json'])
    expect(exitCode).toBeUndefined()
    expect(parsed.name).toBe('staging')
    expect(parsed.mode).toBe('remote')
  })

  test('errors on nonexistent context', async () => {
    const { exitCode, parsed } = await run(context, ['show', 'nope', '--format', 'json'])
    expect(exitCode).toBe(1)
    expect(parsed.code).toBe(ErrorCode.CONTEXT_NOT_FOUND)
  })
})

describe('context rename', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('renames a context', async () => {
    const { mockServerUrl } = await import('./_helpers.js')
    await run(context, ['add', 'staging', mockServerUrl, '--format', 'json'])
    const { exitCode, parsed } = await run(context, ['rename', 'staging', 'prod', '--format', 'json'])
    expect(exitCode).toBeUndefined()
    expect(parsed.renamed.from).toBe('staging')
    expect(parsed.renamed.to).toBe('prod')
  })

  test('cannot rename local', async () => {
    const { exitCode, parsed } = await run(context, ['rename', 'local', 'something', '--format', 'json'])
    expect(exitCode).toBe(1)
    expect(parsed.code).toBe(ErrorCode.CONTEXT_PROTECTED)
  })

  test('updates current_context if renaming active', async () => {
    const { mockServerUrl } = await import('./_helpers.js')
    await run(context, ['add', 'staging', mockServerUrl, '--format', 'json'])
    await run(context, ['use', 'staging', '--format', 'json'])
    await run(context, ['rename', 'staging', 'prod', '--format', 'json'])

    const { parsed } = await run(context, ['list', '--format', 'json'])
    const prod = parsed.contexts.find((c: any) => c.name === 'prod')
    expect(prod).toBeDefined()
    expect(prod.active).toBe(true)
  })
})

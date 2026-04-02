import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { rm, mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { healthCheck, status, downloadAndVerify, fetchLatestVersion, compareSemver } from '../src/daemon.js'

const TEST_HOME = join(import.meta.dir, '..', '.test-home-daemon')
let server: ReturnType<typeof Bun.serve> | null = null
let serverUrl: string

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/healthz') {
        return Response.json({ status: 'ok', version: '0.2.0' })
      }
      return new Response('Not Found', { status: 404 })
    },
  })
  serverUrl = `http://localhost:${server.port}`
})

afterAll(() => {
  server?.stop()
})

beforeEach(async () => {
  process.env.BRAINJAR_TEST_HOME = TEST_HOME
  await mkdir(join(TEST_HOME, '.brainjar'), { recursive: true })
  await writeFile(
    join(TEST_HOME, '.brainjar', 'config.yaml'),
    `server:\n  url: ${serverUrl}\n  mode: remote\nworkspace: test\n`,
  )
})

afterEach(async () => {
  delete process.env.BRAINJAR_TEST_HOME
  await rm(TEST_HOME, { recursive: true, force: true })
})

describe('healthCheck', () => {
  test('returns healthy for running server', async () => {
    const result = await healthCheck({ url: serverUrl })
    expect(result.healthy).toBe(true)
    expect(result.latencyMs).toBeDefined()
    expect(typeof result.latencyMs).toBe('number')
    expect(result.serverVersion).toBe('0.2.0')
  })

  test('returns unhealthy for unreachable server', async () => {
    const result = await healthCheck({ url: 'http://localhost:1', timeout: 500 })
    expect(result.healthy).toBe(false)
    expect(result.error).toBeDefined()
  })

  test('returns unhealthy on timeout', async () => {
    // Use a non-routable IP to trigger timeout
    const result = await healthCheck({ url: 'http://192.0.2.1:7742', timeout: 200 })
    expect(result.healthy).toBe(false)
  })
})

describe('status', () => {
  test('reports remote healthy server', async () => {
    const result = await status()
    expect(result.mode).toBe('remote')
    expect(result.url).toBe(serverUrl)
    expect(result.healthy).toBe(true)
    expect(result.running).toBe(false) // no PID file
    expect(result.pid).toBeNull()
  })

  test('reports unhealthy when server is down', async () => {
    await writeFile(
      join(TEST_HOME, '.brainjar', 'config.yaml'),
      'server:\n  url: http://localhost:1\n  mode: remote\nworkspace: test\n',
    )
    const result = await status()
    expect(result.healthy).toBe(false)
  })
})

// ─── compareSemver ─────────────────────────────────────────────────────────

describe('compareSemver', () => {
  test('equal versions', () => {
    expect(compareSemver('0.2.0', '0.2.0')).toBe(0)
  })

  test('strips v prefix', () => {
    expect(compareSemver('v0.2.0', '0.2.0')).toBe(0)
  })

  test('greater than', () => {
    expect(compareSemver('0.3.0', '0.2.0')).toBe(1)
    expect(compareSemver('1.0.0', '0.9.9')).toBe(1)
  })

  test('less than', () => {
    expect(compareSemver('0.1.9', '0.2.0')).toBe(-1)
    expect(compareSemver('0.2.0', '0.2.1')).toBe(-1)
  })

  test('handles missing patch', () => {
    expect(compareSemver('0.2', '0.2.0')).toBe(0)
  })
})

// ─── helpers ────────────────────────────────────────────────────────────────

/** Create a .tar.gz containing a single file named `brainjar-server` with given content. */
function makeTarball(content: Buffer): Buffer {
  const dir = join(tmpdir(), `brainjar-test-tar-${Date.now()}`)
  const tarPath = join(dir, 'out.tar.gz')
  try {
    require('node:fs').mkdirSync(dir, { recursive: true })
    require('node:fs').writeFileSync(join(dir, 'brainjar-server'), content, { mode: 0o755 })
    execFileSync('tar', ['czf', tarPath, '-C', dir, 'brainjar-server'])
    return require('node:fs').readFileSync(tarPath)
  } finally {
    try { require('node:fs').rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

// ─── fetchLatestVersion ─────────────────────────────────────────────────────

describe('fetchLatestVersion', () => {
  let versionServer: ReturnType<typeof Bun.serve>

  afterAll(() => { versionServer?.stop() })

  test('returns trimmed version string', async () => {
    versionServer = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === '/latest') return new Response('v0.2.0\n')
        return new Response('Not Found', { status: 404 })
      },
    })
    const version = await fetchLatestVersion(`http://localhost:${versionServer.port}`)
    expect(version).toBe('v0.2.0')
  })

  test('throws on HTTP error', async () => {
    versionServer = Bun.serve({
      port: 0,
      fetch() { return new Response('error', { status: 500 }) },
    })
    try {
      await fetchLatestVersion(`http://localhost:${versionServer.port}`)
      expect(true).toBe(false)
    } catch (e: any) {
      expect(e.code).toBe('BINARY_NOT_FOUND')
    }
  })
})

// ─── downloadAndVerify ──────────────────────────────────────────────────────

describe('downloadAndVerify', () => {
  const FAKE_BINARY = Buffer.from('#!/bin/sh\necho fake-server\n')
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const tarballName = `brainjar-server-${platform}-${arch}.tar.gz`

  let fakeTarball: Buffer
  let fakeHash: string
  let dlServer: ReturnType<typeof Bun.serve>
  let dlUrl: string

  beforeAll(() => {
    fakeTarball = makeTarball(FAKE_BINARY)
    fakeHash = createHash('sha256').update(fakeTarball).digest('hex')

    dlServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)

        if (url.pathname === `/${tarballName}`) {
          return new Response(new Uint8Array(fakeTarball), {
            headers: { 'Content-Type': 'application/gzip' },
          })
        }

        if (url.pathname === '/checksums.txt') {
          return new Response(`${fakeHash}  ${tarballName}\n`)
        }

        if (url.pathname === `/bad-checksum/${tarballName}`) {
          return new Response(new Uint8Array(fakeTarball), {
            headers: { 'Content-Type': 'application/gzip' },
          })
        }

        if (url.pathname === '/bad-checksum/checksums.txt') {
          return new Response(`deadbeef00000000000000000000000000000000000000000000000000000000  ${tarballName}\n`)
        }

        if (url.pathname === `/no-checksums/${tarballName}`) {
          return new Response(new Uint8Array(fakeTarball), {
            headers: { 'Content-Type': 'application/gzip' },
          })
        }

        if (url.pathname === '/no-checksums/checksums.txt') {
          return new Response('Not Found', { status: 404 })
        }

        return new Response('Not Found', { status: 404 })
      },
    })
    dlUrl = `http://localhost:${dlServer.port}`
  })

  afterAll(() => {
    dlServer?.stop()
  })

  test('downloads tarball, verifies checksum, extracts binary', async () => {
    const binPath = join(TEST_HOME, '.brainjar', 'bin', 'brainjar-server')
    await downloadAndVerify(binPath, dlUrl)

    await access(binPath)
    const content = await readFile(binPath)
    expect(content.toString()).toContain('fake-server')
  })

  test('rejects checksum mismatch', async () => {
    const binPath = join(TEST_HOME, '.brainjar', 'bin', 'brainjar-server-bad')
    try {
      await downloadAndVerify(binPath, `${dlUrl}/bad-checksum`)
      expect(true).toBe(false)
    } catch (e: any) {
      expect(e.code).toBe('BINARY_NOT_FOUND')
      expect(e.message).toContain('Checksum mismatch')
    }
  })

  test('succeeds without checksums (graceful degradation)', async () => {
    const binPath = join(TEST_HOME, '.brainjar', 'bin', 'brainjar-server-nc')
    await downloadAndVerify(binPath, `${dlUrl}/no-checksums`)
    await access(binPath)
  })

  test('throws on download failure (404)', async () => {
    const binPath = join(TEST_HOME, '.brainjar', 'bin', 'brainjar-server-404')
    try {
      await downloadAndVerify(binPath, `${dlUrl}/nonexistent`)
      expect(true).toBe(false)
    } catch (e: any) {
      expect(e.code).toBe('BINARY_NOT_FOUND')
      expect(e.message).toContain('Failed to download')
    }
  })
})

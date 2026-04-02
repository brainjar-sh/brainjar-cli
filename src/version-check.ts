import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getBrainjarDir } from './paths.js'
import { fetchLatestVersion, DIST_BASE } from './daemon.js'

const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
const NPM_REGISTRY = 'https://registry.npmjs.org'

interface VersionCache {
  checkedAt: number
  cli?: string
  server?: string
}

function cachePath(): string {
  return join(getBrainjarDir(), 'version-cache.json')
}

export function installedVersionPath(): string {
  return join(getBrainjarDir(), 'server-version')
}

/** Read the installed server version, or null if not tracked. */
export async function getInstalledServerVersion(): Promise<string | null> {
  try {
    return (await readFile(installedVersionPath(), 'utf-8')).trim()
  } catch {
    return null
  }
}

/** Write the installed server version after a successful download. */
export async function setInstalledServerVersion(version: string): Promise<void> {
  await mkdir(getBrainjarDir(), { recursive: true })
  await writeFile(installedVersionPath(), version)
}

/** Read the cached version check result. */
async function readCache(): Promise<VersionCache | null> {
  try {
    const raw = await readFile(cachePath(), 'utf-8')
    return JSON.parse(raw) as VersionCache
  } catch {
    return null
  }
}

/** Write the version check cache. */
async function writeCache(cache: VersionCache): Promise<void> {
  await mkdir(getBrainjarDir(), { recursive: true })
  await writeFile(cachePath(), JSON.stringify(cache))
}

/** Fetch the latest CLI version from npm registry. */
async function fetchLatestCliVersion(): Promise<string | null> {
  try {
    const response = await fetch(`${NPM_REGISTRY}/-/package/@brainjar/cli/dist-tags`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return null
    const tags = (await response.json()) as Record<string, string>
    return tags.latest ?? null
  } catch {
    return null
  }
}

export interface UpdateInfo {
  cli?: { current: string; latest: string }
  server?: { current: string; latest: string }
}

/**
 * Check for available updates. Results are cached for 1 hour.
 * Never throws — returns null on any failure.
 */
export async function checkForUpdates(currentCliVersion: string): Promise<UpdateInfo | null> {
  try {
    const cache = await readCache()
    const now = Date.now()

    let latestCli: string | undefined
    let latestServer: string | undefined

    if (cache && (now - cache.checkedAt) < CHECK_INTERVAL_MS) {
      latestCli = cache.cli
      latestServer = cache.server
    } else {
      const [cli, server] = await Promise.all([
        fetchLatestCliVersion(),
        fetchLatestVersion(DIST_BASE).catch(() => null),
      ])

      latestCli = cli ?? undefined
      latestServer = server ?? undefined

      await writeCache({ checkedAt: now, cli: latestCli, server: latestServer }).catch(() => {})
    }

    const info: UpdateInfo = {}

    if (latestCli && latestCli !== currentCliVersion) {
      info.cli = { current: currentCliVersion, latest: latestCli }
    }

    const installedServer = await getInstalledServerVersion()
    if (latestServer && installedServer && latestServer !== installedServer) {
      info.server = { current: installedServer, latest: latestServer }
    }

    if (info.cli || info.server) return info
    return null
  } catch {
    return null
  }
}

/**
 * Render update banner text. Returns undefined if no updates available.
 * Ready to wire into incur's `banner` option.
 */
export async function renderUpdateBanner(currentCliVersion: string): Promise<string | undefined> {
  const updates = await checkForUpdates(currentCliVersion)
  if (!updates) return undefined

  const lines: string[] = []

  if (updates.cli) {
    lines.push(`  ⬆ brainjar ${updates.cli.latest} available (current: ${updates.cli.current}) — brainjar upgrade`)
  }

  if (updates.server) {
    lines.push(`  ⬆ server ${updates.server.latest} available (current: ${updates.server.current}) — brainjar upgrade`)
  }

  return lines.length > 0 ? lines.join('\n') : undefined
}

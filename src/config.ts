import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { getBrainjarDir, paths } from './paths.js'
import type { Backend } from './paths.js'

// ─── Context types ──────────────────────────────────────────────────────────

export interface LocalContext {
  url: string
  mode: 'local'
  bin: string
  pid_file: string
  log_file: string
  workspace: string
}

export interface RemoteContext {
  url: string
  mode: 'remote'
  workspace: string
}

export type ServerContext = LocalContext | RemoteContext

export function isLocalContext(ctx: ServerContext): ctx is LocalContext {
  return ctx.mode === 'local'
}

// ─── Config types ───────────────────────────────────────────────────────────

export interface Config {
  version: 2
  current_context: string
  contexts: Record<string, ServerContext>
  backend: Backend
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Get the active context from config. */
export function activeContext(config: Config): ServerContext {
  return config.contexts[config.current_context]
}

/** Get the local context from config. Always present. */
export function localContext(config: Config): LocalContext {
  return config.contexts.local as LocalContext
}

function defaultLocalContext(): LocalContext {
  const dir = getBrainjarDir()
  return {
    url: 'http://localhost:7742',
    mode: 'local',
    bin: `${dir}/bin/brainjar-server`,
    pid_file: `${dir}/server.pid`,
    log_file: `${dir}/server.log`,
    workspace: 'default',
  }
}

function defaults(): Config {
  return {
    version: 2,
    current_context: 'local',
    contexts: { local: defaultLocalContext() },
    backend: 'claude',
  }
}

function isValidMode(v: unknown): v is 'local' | 'remote' {
  return v === 'local' || v === 'remote'
}

function isValidBackend(v: unknown): v is Backend {
  return v === 'claude' || v === 'codex'
}

/** Derive a context name from a URL hostname. */
export function contextNameFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname
    return hostname.replace(/\./g, '-')
  } catch {
    return 'remote'
  }
}

/** Find a unique context name, appending -2, -3, etc. if needed. */
export function uniqueContextName(base: string, existing: Record<string, unknown>): string {
  if (!(base in existing)) return base
  let i = 2
  while (`${base}-${i}` in existing) i++
  return `${base}-${i}`
}

// ─── Migration: v1 → v2 ────────────────────────────────────────────────────

interface V1Config {
  server: {
    url: string
    mode: 'local' | 'remote'
    bin: string
    pid_file: string
    log_file: string
  }
  workspace: string
  backend: Backend
}

function migrateV1(v1: V1Config): Config {
  const dir = getBrainjarDir()
  const localCtx: LocalContext = {
    url: 'http://localhost:7742',
    mode: 'local',
    bin: v1.server.bin || `${dir}/bin/brainjar-server`,
    pid_file: v1.server.pid_file || `${dir}/server.pid`,
    log_file: v1.server.log_file || `${dir}/server.log`,
    workspace: v1.workspace || 'default',
  }

  const config: Config = {
    version: 2,
    current_context: 'local',
    contexts: { local: localCtx },
    backend: v1.backend || 'claude',
  }

  if (v1.server.mode === 'remote') {
    const name = contextNameFromUrl(v1.server.url)
    const uniqueName = uniqueContextName(name, config.contexts)
    config.contexts[uniqueName] = {
      url: v1.server.url,
      mode: 'remote',
      workspace: v1.workspace || 'default',
    }
    config.current_context = uniqueName
  }

  return config
}

// ─── Read / Write ───────────────────────────────────────────────────────────

/**
 * Read config from ~/.brainjar/config.yaml.
 * Returns defaults if file doesn't exist.
 * Migrates v1 configs to v2 on read.
 * Applies env var overrides on top.
 */
export async function readConfig(): Promise<Config> {
  let config: Config

  try {
    const raw = await readFile(paths.config, 'utf-8')
    let parsed: unknown
    try {
      parsed = parseYaml(raw)
    } catch (e) {
      throw new Error(`config.yaml is corrupt: ${(e as Error).message}`)
    }

    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>

      if (p.version === 2) {
        // v2 config
        config = parseV2(p)
      } else {
        // v1 config (no version field)
        config = parseV1(p)
      }
    } else {
      config = defaults()
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return applyEnvOverrides(defaults())
    throw e
  }

  return applyEnvOverrides(config)
}

function parseV2(p: Record<string, unknown>): Config {
  const def = defaults()
  const defLocal = localContext(def)
  const config: Config = {
    version: 2,
    current_context: typeof p.current_context === 'string' ? p.current_context : 'local',
    contexts: {},
    backend: isValidBackend(p.backend) ? p.backend : def.backend,
  }

  if (p.contexts && typeof p.contexts === 'object') {
    for (const [name, raw] of Object.entries(p.contexts as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue
      const ctx = raw as Record<string, unknown>
      if (ctx.mode === 'local') {
        config.contexts[name] = {
          url: typeof ctx.url === 'string' ? ctx.url : 'http://localhost:7742',
          mode: 'local',
          bin: typeof ctx.bin === 'string' ? ctx.bin : defLocal.bin,
          pid_file: typeof ctx.pid_file === 'string' ? ctx.pid_file : defLocal.pid_file,
          log_file: typeof ctx.log_file === 'string' ? ctx.log_file : defLocal.log_file,
          workspace: typeof ctx.workspace === 'string' ? ctx.workspace : 'default',
        }
      } else {
        config.contexts[name] = {
          url: typeof ctx.url === 'string' ? ctx.url : '',
          mode: 'remote',
          workspace: typeof ctx.workspace === 'string' ? ctx.workspace : 'default',
        }
      }
    }
  }

  // Ensure local context always exists
  if (!config.contexts.local) {
    config.contexts.local = defaultLocalContext()
  }

  // Ensure current_context points to an existing context
  if (!(config.current_context in config.contexts)) {
    config.current_context = 'local'
  }

  return config
}

function parseV1(p: Record<string, unknown>): Config {
  const dir = getBrainjarDir()
  const v1: V1Config = {
    server: {
      url: 'http://localhost:7742',
      mode: 'local',
      bin: `${dir}/bin/brainjar-server`,
      pid_file: `${dir}/server.pid`,
      log_file: `${dir}/server.log`,
    },
    workspace: 'default',
    backend: 'claude',
  }

  if (typeof p.workspace === 'string') v1.workspace = p.workspace
  if (isValidBackend(p.backend)) v1.backend = p.backend

  if (p.server && typeof p.server === 'object') {
    const s = p.server as Record<string, unknown>
    if (typeof s.url === 'string') v1.server.url = s.url
    if (isValidMode(s.mode)) v1.server.mode = s.mode
    if (typeof s.bin === 'string') v1.server.bin = s.bin
    if (typeof s.pid_file === 'string') v1.server.pid_file = s.pid_file
    if (typeof s.log_file === 'string') v1.server.log_file = s.log_file
  }

  return migrateV1(v1)
}

function applyEnvOverrides(config: Config): Config {
  const ctx = activeContext(config)

  const url = process.env.BRAINJAR_SERVER_URL
  if (typeof url === 'string' && url) ctx.url = url

  const workspace = process.env.BRAINJAR_WORKSPACE
  if (typeof workspace === 'string' && workspace) ctx.workspace = workspace

  const backend = process.env.BRAINJAR_BACKEND
  if (isValidBackend(backend)) config.backend = backend

  return config
}

/**
 * Write config to ~/.brainjar/config.yaml.
 * Always writes v2 format. Atomic write (tmp + rename).
 */
export async function writeConfig(config: Config): Promise<void> {
  const doc: Record<string, unknown> = {
    version: 2,
    current_context: config.current_context,
    contexts: {} as Record<string, unknown>,
    backend: config.backend,
  }

  const contexts = doc.contexts as Record<string, unknown>
  for (const [name, ctx] of Object.entries(config.contexts)) {
    if (isLocalContext(ctx)) {
      contexts[name] = {
        url: ctx.url,
        mode: ctx.mode,
        bin: ctx.bin,
        pid_file: ctx.pid_file,
        log_file: ctx.log_file,
        workspace: ctx.workspace,
      }
    } else {
      contexts[name] = {
        url: ctx.url,
        mode: ctx.mode,
        workspace: ctx.workspace,
      }
    }
  }

  await mkdir(dirname(paths.config), { recursive: true })
  const tmp = `${paths.config}.tmp`
  await writeFile(tmp, stringifyYaml(doc))
  await rename(tmp, paths.config)
}

/** Get the config file path. */
export function getConfigPath(): string {
  return paths.config
}

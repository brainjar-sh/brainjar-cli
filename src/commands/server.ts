import { Cli, z, Errors } from 'incur'
import { spawn } from 'node:child_process'
import {
  healthCheck,
  start,
  stop,
  status as daemonStatus,
  ensureRunning,
  readLogFile,
} from '../daemon.js'
import { readConfig, writeConfig, activeContext, localContext, contextNameFromUrl, uniqueContextName } from '../config.js'
import { getApi } from '../client.js'
import { sync } from '../sync.js'

const { IncurError } = Errors
import { ErrorCode, createError } from '../errors.js'

function assertLocalContext(config: { current_context: string; contexts: Record<string, { mode: string }> }, action: string) {
  const ctx = config.contexts[config.current_context]
  if (ctx.mode === 'remote') {
    throw createError(ErrorCode.INVALID_MODE, {
      message: `Active context is remote. Cannot ${action}.`,
    })
  }
}

const statusCmd = Cli.create('status', {
  description: 'Show server status',
  async run() {
    const s = await daemonStatus()
    const health = await healthCheck({ timeout: 2000 })
    return {
      mode: s.mode,
      url: s.url,
      healthy: s.healthy,
      running: s.running,
      pid: s.pid,
      serverVersion: health.serverVersion ?? null,
      latencyMs: health.latencyMs ?? null,
    }
  },
})

const startCmd = Cli.create('start', {
  description: 'Start the local server daemon',
  async run() {
    const config = await readConfig()
    assertLocalContext(config, 'start')
    const ctx = activeContext(config)

    const health = await healthCheck({ timeout: 2000 })
    if (health.healthy) {
      const s = await daemonStatus()
      return { already_running: true, pid: s.pid, url: ctx.url }
    }

    const { pid } = await start()

    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200))
      const check = await healthCheck({ timeout: 2000 })
      if (check.healthy) return { started: true, pid, url: ctx.url }
    }

    throw createError(ErrorCode.SERVER_START_FAILED, {
      message: 'Server started but failed health check after 10s.',
    })
  },
})

const stopCmd = Cli.create('stop', {
  description: 'Stop the local server daemon',
  async run() {
    const config = await readConfig()
    assertLocalContext(config, 'stop')

    const result = await stop()
    if (!result.stopped) {
      return { stopped: false, reason: 'not running' }
    }
    return { stopped: true }
  },
})

const logsCmd = Cli.create('logs', {
  description: 'Show server logs',
  options: z.object({
    lines: z.number().default(50).describe('Number of lines to show'),
    follow: z.boolean().default(false).describe('Follow log output'),
  }),
  async run(c) {
    const config = await readConfig()
    const local = localContext(config)

    if (c.options.follow) {
      const child = spawn('tail', ['-f', '-n', String(c.options.lines), local.log_file], {
        stdio: 'inherit',
      })
      await new Promise<void>((resolve) => {
        child.on('close', () => resolve())
      })
      return
    }

    const content = await readLogFile({ lines: c.options.lines })
    return content || 'No logs found.'
  },
})

const localCmd = Cli.create('local', {
  description: 'Switch to local server (use `brainjar context use local` instead)',
  async run() {
    const config = await readConfig()
    config.current_context = 'local'
    await writeConfig(config)

    await ensureRunning()

    const api = await getApi()
    const ctx = activeContext(config)

    try {
      await api.post('/api/v1/workspaces', { name: ctx.workspace }, { headers: { 'X-Brainjar-Workspace': '' } })
    } catch (e: any) {
      if (e.code !== 'CONFLICT') throw e
    }

    await sync({ api })

    return { mode: 'local', url: ctx.url }
  },
})

const remoteCmd = Cli.create('remote', {
  description: 'Switch to a remote server (use `brainjar context add` instead)',
  args: z.object({
    url: z.string().describe('Remote server URL'),
  }),
  async run(c) {
    const url = c.args.url.replace(/\/$/, '')

    const health = await healthCheck({ url, timeout: 5000 })
    if (!health.healthy) {
      throw createError(ErrorCode.SERVER_UNREACHABLE, { params: [url] })
    }

    const config = await readConfig()

    // Find existing context with this URL, or create one
    let ctxName = Object.entries(config.contexts).find(([, ctx]) => ctx.url === url)?.[0]
    if (!ctxName) {
      ctxName = uniqueContextName(contextNameFromUrl(url), config.contexts)
      config.contexts[ctxName] = {
        url,
        mode: 'remote',
        workspace: 'default',
      }
    }

    config.current_context = ctxName
    await writeConfig(config)

    const api = await getApi()
    const ctx = activeContext(config)

    try {
      await api.post('/api/v1/workspaces', { name: ctx.workspace }, { headers: { 'X-Brainjar-Workspace': '' } })
    } catch (e: any) {
      if (e.code !== 'CONFLICT') throw e
    }

    await sync({ api })

    return { mode: 'remote', url }
  },
})

export const server = Cli.create('server', {
  description: 'Manage the brainjar server',
})
  .command(statusCmd)
  .command(startCmd)
  .command(stopCmd)
  .command(logsCmd)
  .command(localCmd)
  .command(remoteCmd)

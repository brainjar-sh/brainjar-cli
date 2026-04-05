import { Cli, z } from 'incur'
import { readConfig, writeConfig, activeContext, isLocalContext, contextNameFromUrl, uniqueContextName } from '../config.js'
import type { RemoteContext } from '../config.js'
import { healthCheck, ensureRunning } from '../daemon.js'
import { getApi } from '../client.js'
import { sync } from '../sync.js'
import { ErrorCode, createError } from '../errors.js'

const SLUG_RE = /^[a-zA-Z0-9_-]+$/

const listCmd = Cli.create('list', {
  description: 'List all contexts',
  async run() {
    const config = await readConfig()
    const entries = Object.entries(config.contexts).map(([name, ctx]) => ({
      name,
      active: name === config.current_context,
      mode: ctx.mode,
      url: ctx.url,
      workspace: ctx.workspace,
    }))
    return { contexts: entries }
  },
})

const addCmd = Cli.create('add', {
  description: 'Add a remote context',
  args: z.object({
    name: z.string().describe('Context name'),
    url: z.string().describe('Server URL'),
  }),
  options: z.object({
    workspace: z.string().default('default').describe('Workspace name'),
  }),
  async run(c) {
    const name = c.args.name
    const url = c.args.url.replace(/\/$/, '')

    if (!SLUG_RE.test(name)) {
      throw createError(ErrorCode.VALIDATION_ERROR, {
        message: `Invalid context name "${name}". Use only letters, numbers, hyphens, and underscores.`,
      })
    }

    if (name === 'local') {
      throw createError(ErrorCode.CONTEXT_PROTECTED, { params: ['local'] })
    }

    const config = await readConfig()

    if (name in config.contexts) {
      throw createError(ErrorCode.CONTEXT_EXISTS, { params: [name] })
    }

    const health = await healthCheck({ url, timeout: 5000 })
    if (!health.healthy) {
      throw createError(ErrorCode.SERVER_UNREACHABLE, { params: [url] })
    }

    config.contexts[name] = {
      url,
      mode: 'remote',
      workspace: c.options.workspace,
    }
    await writeConfig(config)

    return { added: name, url, hint: `Switch with \`brainjar context use ${name}\`` }
  },
})

const removeCmd = Cli.create('remove', {
  description: 'Remove a context',
  args: z.object({
    name: z.string().describe('Context name'),
  }),
  async run(c) {
    const name = c.args.name
    const config = await readConfig()

    if (name === 'local') {
      throw createError(ErrorCode.CONTEXT_PROTECTED, { params: ['local'] })
    }

    if (!(name in config.contexts)) {
      throw createError(ErrorCode.CONTEXT_NOT_FOUND, { params: [name] })
    }

    if (name === config.current_context) {
      throw createError(ErrorCode.CONTEXT_ACTIVE, { params: [name] })
    }

    delete config.contexts[name]
    await writeConfig(config)

    return { removed: name }
  },
})

const useCmd = Cli.create('use', {
  description: 'Switch active context',
  args: z.object({
    name: z.string().describe('Context name'),
  }),
  async run(c) {
    const name = c.args.name
    const config = await readConfig()

    if (!(name in config.contexts)) {
      throw createError(ErrorCode.CONTEXT_NOT_FOUND, { params: [name] })
    }

    config.current_context = name
    await writeConfig(config)

    const ctx = activeContext(config)

    // If switching to local, ensure running
    if (isLocalContext(ctx)) {
      await ensureRunning()
    }

    // Sync if server is reachable
    const health = await healthCheck({ url: ctx.url, timeout: 3000 })
    if (health.healthy) {
      const api = await getApi()

      // Ensure workspace exists
      try {
        await api.post('/api/v1/workspaces', { name: ctx.workspace }, { headers: { 'X-Brainjar-Workspace': '' } })
      } catch (e: any) {
        if (e.code !== 'CONFLICT') throw e
      }

      await sync({ api })
    }

    return { active: name, mode: ctx.mode, url: ctx.url, workspace: ctx.workspace }
  },
})

const showCmd = Cli.create('show', {
  description: 'Show context details',
  args: z.object({
    name: z.string().optional().describe('Context name (defaults to active)'),
  }),
  async run(c) {
    const config = await readConfig()
    const name = c.args.name ?? config.current_context

    if (!(name in config.contexts)) {
      throw createError(ErrorCode.CONTEXT_NOT_FOUND, { params: [name] })
    }

    const ctx = config.contexts[name]
    return {
      name,
      active: name === config.current_context,
      ...ctx,
    }
  },
})

const renameCmd = Cli.create('rename', {
  description: 'Rename a context',
  args: z.object({
    old: z.string().describe('Current name'),
    new: z.string().describe('New name'),
  }),
  async run(c) {
    const oldName = c.args.old
    const newName = c.args.new

    if (oldName === 'local') {
      throw createError(ErrorCode.CONTEXT_PROTECTED, { params: ['local'] })
    }

    if (newName === 'local') {
      throw createError(ErrorCode.CONTEXT_PROTECTED, {
        message: 'Cannot rename to "local" — that name is reserved.',
      })
    }

    if (!SLUG_RE.test(newName)) {
      throw createError(ErrorCode.VALIDATION_ERROR, {
        message: `Invalid context name "${newName}". Use only letters, numbers, hyphens, and underscores.`,
      })
    }

    const config = await readConfig()

    if (!(oldName in config.contexts)) {
      throw createError(ErrorCode.CONTEXT_NOT_FOUND, { params: [oldName] })
    }

    if (newName in config.contexts) {
      throw createError(ErrorCode.CONTEXT_EXISTS, { params: [newName] })
    }

    config.contexts[newName] = config.contexts[oldName]
    delete config.contexts[oldName]

    if (config.current_context === oldName) {
      config.current_context = newName
    }

    await writeConfig(config)

    return { renamed: { from: oldName, to: newName } }
  },
})

const setTokenCmd = Cli.create('set-token', {
  description: 'Store an API key for a context',
  args: z.object({
    name: z.string().describe('Context name'),
    key: z.string().describe('API key (bjk_...)'),
  }),
  async run(c) {
    const config = await readConfig()

    if (!(c.args.name in config.contexts)) {
      throw createError(ErrorCode.CONTEXT_NOT_FOUND, { params: [c.args.name] })
    }

    const ctx = config.contexts[c.args.name]
    if (isLocalContext(ctx)) {
      throw createError(ErrorCode.VALIDATION_ERROR, {
        message: 'Cannot set a token on a local context. Local contexts use auto-generated tokens.',
      })
    }

    ctx.token = c.args.key
    await writeConfig(config)

    return { context: c.args.name, token_set: true }
  },
})

export const context = Cli.create('context', {
  description: 'Manage server contexts — named server profiles',
})
  .command(listCmd)
  .command(addCmd)
  .command(removeCmd)
  .command(useCmd)
  .command(showCmd)
  .command(renameCmd)
  .command(setTokenCmd)

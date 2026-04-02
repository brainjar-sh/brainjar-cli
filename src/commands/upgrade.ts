import { Cli, z } from 'incur'
import { upgradeCli, upgradeServerBinary } from '../upgrade.js'
import type { UpgradeResult } from '../upgrade.js'
import { ErrorCode, createError } from '../errors.js'

export const upgrade = Cli.create('upgrade', {
  description: 'Upgrade brainjar CLI and server to latest versions',
  options: z.object({
    'cli-only': z.boolean().default(false).describe('Only upgrade the CLI'),
    'server-only': z.boolean().default(false).describe('Only upgrade the server'),
  }),
  async run(c) {
    const cliOnly = c.options['cli-only']
    const serverOnly = c.options['server-only']

    if (cliOnly && serverOnly) {
      throw createError(ErrorCode.MUTUALLY_EXCLUSIVE, {
        message: '--cli-only and --server-only are mutually exclusive.',
      })
    }

    const result: UpgradeResult = {}

    if (!serverOnly) {
      result.cli = await upgradeCli()
    }

    // Server upgrade always targets the local binary, regardless of active context
    if (!cliOnly) {
      result.server = await upgradeServerBinary()
    }

    return result
  },
})

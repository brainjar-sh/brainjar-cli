import { Cli, z } from 'incur'
import { getApi } from '../client.js'
import type { ApiCreateKeyResult, ApiKeyList } from '../api-types.js'

export const apiKey = Cli.create('api-key', {
  description: 'Manage API keys for remote server authentication',
})
  .command('create', {
    description: 'Create a new API key',
    options: z.object({
      name: z.string().describe('Key name (e.g. ci-pipeline)'),
      'user-id': z.string().optional().describe('User ID label for the key'),
      'expires-in': z.string().optional().describe('Expiration duration (e.g. 30d, 90d, 365d)'),
    }),
    async run(c) {
      const api = await getApi()
      const result = await api.post<ApiCreateKeyResult>('/api/v1/api-keys', {
        name: c.options.name,
        user_id: c.options['user-id'] ?? '',
        expires_in: c.options['expires-in'] ?? '',
      })
      return {
        id: result.id,
        name: result.name,
        key: result.key,
        key_prefix: result.key_prefix,
        expires_at: result.expires_at,
        warning: 'Save this key now — it will not be shown again.',
      }
    },
  })
  .command('list', {
    description: 'List API keys',
    async run() {
      const api = await getApi()
      const result = await api.get<ApiKeyList>('/api/v1/api-keys')
      return result
    },
  })
  .command('revoke', {
    description: 'Revoke an API key',
    args: z.object({
      id: z.string().describe('API key ID'),
    }),
    async run(c) {
      const api = await getApi()
      await api.delete(`/api/v1/api-keys/${c.args.id}`)
      return { revoked: c.args.id }
    },
  })

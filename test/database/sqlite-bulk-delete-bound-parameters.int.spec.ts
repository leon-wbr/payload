import { expect } from 'vitest'

import { test } from '../__helpers/int/vitest.js'

/**
 * Cloudflare D1 allows at most 100 bound parameters per statement. This simulates that limit on
 * the libSQL client to cover bulk operations through the Local API end to end.
 */
test.suite(
  'database - sqlite bulk operations within the bound parameters limit',
  { config: './config.ts', db: (adapter) => adapter.startsWith('sqlite') },
  () => {
    test('should bulk delete more than 100 documents when limitedBoundParameters: true', async ({
      payload,
    }) => {
      // Repro for https://github.com/payloadcms/payload/issues/19233
      const docs = await Promise.all(
        Array.from({ length: 120 }, () =>
          payload.create({ collection: 'simple', data: {}, overrideAccess: true }),
        ),
      )
      const ids = docs.map((doc) => doc.id)

      const client = payload.db.drizzle.$client
      const defaultExecute = client.execute.bind(client)

      client.execute = async function execute(...args) {
        const [statement] = args as [{ args?: unknown[] } | string]

        if (
          typeof statement === 'object' &&
          Array.isArray(statement.args) &&
          statement.args.length > 100
        ) {
          throw new Error('D1_ERROR: too many SQL variables at offset 0: SQLITE_ERROR')
        }

        return await defaultExecute(...args)
      } as typeof client.execute

      const defaultLimitedBoundParameters = payload.db.limitedBoundParameters
      payload.db.limitedBoundParameters = true

      try {
        const result = await payload.delete({
          collection: 'simple',
          overrideAccess: true,
          where: { id: { in: ids } },
        })

        expect(result.errors).toEqual([])
        expect(result.docs).toHaveLength(120)
      } finally {
        client.execute = defaultExecute
        payload.db.limitedBoundParameters = defaultLimitedBoundParameters
      }

      const { totalDocs } = await payload.count({
        collection: 'simple',
        overrideAccess: true,
        where: { id: { in: ids } },
      })

      expect(totalDocs).toBe(0)
    })
  },
)

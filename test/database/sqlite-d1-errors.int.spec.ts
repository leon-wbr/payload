import type { ValidationError } from 'payload'

import { expect } from 'vitest'

import { test } from '../__helpers/int/vitest.js'

/**
 * Cloudflare D1 reports SQLite errors as a plain `Error` without a `code`, e.g.
 * `D1_ERROR: UNIQUE constraint failed: posts.slug: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)`.
 * These tests rethrow libSQL's errors in that shape to cover `@payloadcms/db-d1-sqlite`.
 */
test.suite(
  'database - sqlite D1 errors',
  { config: './config.ts', db: (adapter) => adapter.startsWith('sqlite') },
  () => {
    test('should throw a ValidationError for unique constraint errors in the D1 format', async ({
      payload,
    }) => {
      const client = payload.db.drizzle.$client
      const defaultExecute = client.execute.bind(client)

      client.execute = async function execute(...args) {
        try {
          return await defaultExecute(...args)
        } catch (error) {
          const message = error instanceof Error ? error.message : ''
          const index = message.indexOf('UNIQUE constraint failed')

          if (index === -1) {
            throw error
          }

          const d1Message = `${message.slice(index)}: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)`

          throw new Error(`D1_ERROR: ${d1Message}`, { cause: new Error(d1Message) })
        }
      } as typeof client.execute

      try {
        await payload.create({
          collection: 'unique-fields',
          data: { slugField: 'd1-unique' },
          overrideAccess: true,
        })

        const duplicate = await payload.create({
          collection: 'unique-fields',
          data: { slugField: 'd1-unique-other' },
          overrideAccess: true,
        })

        const errors: unknown[] = []

        await payload
          .create({
            collection: 'unique-fields',
            data: { slugField: 'd1-unique' },
            overrideAccess: true,
          })
          .catch((error: unknown) => errors.push(error))

        // Optimized update path
        await payload
          .update({
            id: duplicate.id,
            collection: 'unique-fields',
            data: { slugField: 'd1-unique' },
            overrideAccess: true,
          })
          .catch((error: unknown) => errors.push(error))

        expect(errors).toHaveLength(2)

        for (const error of errors) {
          expect((error as Error).name).toBe('ValidationError')
          const { data } = error as ValidationError
          expect(data.collection).toBe('unique-fields')
          expect(data.errors).toEqual([
            expect.objectContaining({ message: 'Value must be unique', path: 'slugField' }),
          ])
        }
      } finally {
        client.execute = defaultExecute
      }
    })
  },
)

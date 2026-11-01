import { ValidationError } from 'payload'
import { describe, expect, it } from 'vitest'

import type { DrizzleAdapter } from '../types.js'

import { handleUpsertError } from './handleUpsertError.js'

const adapter = { fieldConstraints: {} } as unknown as DrizzleAdapter

describe('handleUpsertError', () => {
  it('preserves the failing sub-table name on the ValidationError', () => {
    const pgError = {
      code: '23505',
      constraint: 'ultrasonic_avail_country_pkey',
      detail: 'Key (id)=(6a27e2a63f4b64567370f595) already exists.',
    }

    let thrown: unknown
    try {
      handleUpsertError({
        adapter,
        collectionSlug: 'ultrasonic',
        error: pgError,
        tableName: 'ultrasonic_avail_country',
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ValidationError)
    const validationError = thrown as ValidationError
    const fieldError = validationError.data.errors[0]!
    expect(fieldError.path).toBe('id')
    expect(fieldError.tableName).toBe('ultrasonic_avail_country')
  })

  it('converts Cloudflare D1 unique constraint errors, which carry no code', () => {
    const adapterWithConstraints = {
      fieldConstraints: { posts: { slug_field_idx: 'slugField' } },
    } as unknown as DrizzleAdapter

    const messages = [
      'D1_ERROR: UNIQUE constraint failed: posts.slug_field: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)',
      'D1_ERROR: UNIQUE constraint failed: posts.slug_field: SQLITE_CONSTRAINT',
    ]

    for (const message of messages) {
      // drizzle-orm wraps the error thrown by the D1 binding in a DrizzleQueryError
      const drizzleError = new Error('Failed query', { cause: new Error(message) })

      let thrown: unknown
      try {
        handleUpsertError({
          adapter: adapterWithConstraints,
          collectionSlug: 'posts',
          error: drizzleError,
          tableName: 'posts',
        })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(ValidationError)
      const fieldError = (thrown as ValidationError).data.errors[0]!
      expect(fieldError.path).toBe('slugField')
      expect(fieldError.tableName).toBe('posts')
    }
  })

  it('re-throws other Cloudflare D1 errors unchanged', () => {
    const d1Error = new Error('D1_ERROR: no such table: posts: SQLITE_ERROR')

    expect(() =>
      handleUpsertError({
        adapter,
        collectionSlug: 'posts',
        error: d1Error,
        tableName: 'posts',
      }),
    ).toThrow(d1Error)
  })

  it('re-throws non unique-constraint errors unchanged', () => {
    const otherError = new Error('some other db error')

    expect(() =>
      handleUpsertError({
        adapter,
        collectionSlug: 'ultrasonic',
        error: otherError,
        tableName: 'ultrasonic_avail_country',
      }),
    ).toThrow(otherError)
  })
})

import type { PayloadRequest } from 'payload'

import { ValidationError } from 'payload'

import type { DrizzleAdapter } from '../types.js'

type HandleUpsertErrorArgs = {
  adapter: DrizzleAdapter
  collectionSlug?: string
  error: unknown
  globalSlug?: string
  id?: number | string
  req?: Partial<PayloadRequest>
  tableName: string
}

/**
 * Handles unique constraint violation errors from PostgreSQL and SQLite,
 * converting them to Payload ValidationErrors.
 * Re-throws non-constraint errors unchanged.
 */
export const handleUpsertError = ({
  id,
  adapter,
  collectionSlug,
  error: caughtError,
  globalSlug,
  req,
  tableName,
}: HandleUpsertErrorArgs): never => {
  let error: any = caughtError
  if (typeof caughtError === 'object' && caughtError !== null && 'cause' in caughtError) {
    error = caughtError.cause
  }

  // SQLite: SQLITE_CONSTRAINT_UNIQUE. Cloudflare D1 errors have no code, only SQLite's message:
  // "D1_ERROR: UNIQUE constraint failed: posts.slug: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)"
  const isSQLiteUniqueError =
    error?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (!error?.code &&
      typeof error?.message === 'string' &&
      error.message.includes('UNIQUE constraint failed:'))

  // PostgreSQL: 23505
  if (error?.code === '23505' || isSQLiteUniqueError) {
    let fieldName: null | string = null

    if (error.code === '23505') {
      // PostgreSQL - extract field name from constraint
      if (adapter.fieldConstraints?.[tableName]?.[error.constraint]) {
        fieldName = adapter.fieldConstraints[tableName][error.constraint]
      } else {
        const replacement = `${tableName}_`
        if (error.constraint?.includes(replacement)) {
          const replacedConstraint = error.constraint.replace(replacement, '')
          if (replacedConstraint && adapter.fieldConstraints[tableName]?.[replacedConstraint]) {
            fieldName = adapter.fieldConstraints[tableName][replacedConstraint]
          }
        }
      }

      if (!fieldName && error.detail) {
        // Extract from detail: "Key (field)=(value) already exists."
        const regex = /Key \(([^)]+)\)=\(([^)]+)\)/
        const match: string[] = error.detail.match(regex)
        if (match && match[1]) {
          fieldName = match[1]
        }
      }
    } else {
      // SQLite - extract from message: "UNIQUE constraint failed: table.field[, table.field2, ...]"
      // D1 appends ": SQLITE_CONSTRAINT ...", so the field name stops at a colon or whitespace too
      const regex = /UNIQUE constraint failed: ([^.]+)\.([^.,:\s]+)/
      const match: string[] = error.message?.match(regex)
      if (match && match[2]) {
        if (adapter.fieldConstraints[tableName]) {
          fieldName = adapter.fieldConstraints[tableName][`${match[2]}_idx`]
        }
        if (!fieldName) {
          fieldName = match[2]
        }
      }
    }

    throw new ValidationError(
      {
        id,
        collection: collectionSlug,
        errors: [
          {
            message: req?.t ? req.t('error:valueMustBeUnique') : 'Value must be unique',
            path: fieldName,
            tableName,
          },
        ],
        global: globalSlug,
        req,
      },
      req?.t,
    )
  }

  // Re-throw non-constraint errors
  throw caughtError
}

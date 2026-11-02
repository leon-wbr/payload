import type { DefaultDocumentIDType, Locale } from '../index.js'
import type { PayloadRequest, Where } from '../types/index.js'

import { isolateObjectProperty } from './isolateObjectProperty.js'

export type DocumentMatchingWhereExistsArgs = {
  collection: string
  /**
   * When true, matches documents whose value exists in their latest (draft) version or in their
   * main row. A versioned collection keeps draft data in `_versions`, which the main-collection
   * query would miss, while the unique index is on the main rows.
   */
  draftsEnabled?: boolean
  /** Exclude this document, so a document does not conflict with itself on update. */
  id?: DefaultDocumentIDType
  locale?: Locale['code']
  overrideAccess?: boolean
  req: PayloadRequest
  where: Where
}

/** Whether another document in `collection` matches `where`. */
export const documentMatchingWhereExists = async ({
  id,
  collection,
  draftsEnabled,
  locale,
  overrideAccess = false,
  req,
  where,
}: DocumentMatchingWhereExistsArgs): Promise<boolean> => {
  const queryReq = isolateObjectProperty(req, ['query', 'transactionID'])
  queryReq.query = { ...req.query }
  delete queryReq.transactionID
  const includeTrashed = Boolean(req.payload.collections[collection]?.config.trash)

  // With drafts, a document's latest version and its main row can hold different values (a draft
  // save that changed a never-published document's value), and the unique index is on the main
  // rows, so check both.
  for (const draft of draftsEnabled ? [true, false] : [false]) {
    const { docs } = await req.payload.find({
      collection,
      depth: 0,
      disableErrors: true,
      draft,
      limit: 2,
      locale,
      overrideAccess,
      pagination: false,
      req: queryReq,
      trash: includeTrashed,
      where,
    })

    if (docs.some((doc) => doc.id !== id)) {
      return true
    }
  }

  return false
}

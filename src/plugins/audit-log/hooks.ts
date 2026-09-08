import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  PayloadRequest,
  RequiredDataFromCollectionSlug,
} from 'payload'

import { type Diff, diffValues, flatten } from './diff'

/**
 * Writes the audit trail. See ./collection.ts for why this exists (Payload's versions
 * record what and when, but carry no user column) and ./diff.ts for how changes are
 * narrowed down to individual fields inside blocks.
 */

/** Never meaningful as "a change a person made". */
const NEVER_DIFF = new Set([
  'id',
  'updatedAt',
  'createdAt',
  // Computed on read, never stored — see src/collections/ProductContent.ts
  'resolvedDetail',
  'templateApplied',
  // Written by Payload itself on every login, not by a person.
  'sessions',
  'loginAttempts',
  'lockUntil',
])

/** Best-effort human label so a deleted document is still identifiable in the trail. */
const labelFor = (doc: Record<string, unknown>): string | undefined => {
  for (const key of ['title', 'marketingName', 'name', 'slug', 'medusaProductId', 'email']) {
    const v = doc?.[key]
    if (typeof v === 'string' && v) return v
  }
  return undefined
}

const contextOf = (req: PayloadRequest, extra: Record<string, unknown> = {}) => ({
  ip:
    req.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers?.get('x-real-ip') ??
    null,
  userAgent: req.headers?.get('user-agent') ?? null,
  ...extra,
})

const write = async (
  req: PayloadRequest,
  // Typed against the generated collection rather than Record<string, unknown> -- the loose
  // type makes TypeScript fall through to payload.create's draft overload and report a
  // confusing "Property 'draft' is missing".
  entry: RequiredDataFromCollectionSlug<'audit-log'>,
): Promise<void> => {
  try {
    await req.payload.create({
      collection: 'audit-log',
      data: entry,
      // The collection denies create to everyone. This is the only path in, which is what
      // makes the trail immutable rather than merely conventionally append-only.
      overrideAccess: true,
    })
  } catch (error) {
    // An audit failure must never block the editor's save, but it must be loud — a silently
    // missing entry is the one failure mode that defeats the purpose.
    req.payload.logger.error({ err: error, entry }, 'AUDIT LOG WRITE FAILED')
  }
}

export const auditChange =
  (collectionSlug: string, redact: string[] = []): CollectionAfterChangeHook =>
  async ({ doc, previousDoc, req, operation, context }) => {
    // Autosave fires every 375ms while an editor types. Logging each one buries the
    // deliberate saves under hundreds of keystroke-level rows.
    if (context?.isAutosave) return doc

    // Bulk work — seeds, migrations, the Magento content import — passes this. Thousands
    // of per-document rows recording "the importer created everything" is storage spent on
    // something a single line in a runbook already says. Set it on the Local API call:
    //   payload.create({ ..., context: { skipAudit: true } })
    if (context?.skipAudit) return doc

    const skip = (key: string) => NEVER_DIFF.has(key) || redact.includes(key)
    const changes: Diff = {}

    if (operation === 'update' && previousDoc) {
      for (const key of new Set([...Object.keys(doc ?? {}), ...Object.keys(previousDoc)])) {
        if (skip(key)) continue
        diffValues(key, previousDoc[key], doc?.[key], changes, 0, skip)
      }
      // Nothing a person would recognise as a change — do not write a row.
      if (Object.keys(changes).length === 0) return doc
    } else {
      // CREATE: record which fields were populated, not their values.
      //
      // Storing the values would make every audit row a second copy of the document it
      // describes — and creates are the bulk of the volume during an initial content load.
      // Nothing is lost: the document still exists, and its first version holds exactly
      // these values. Deletes are the opposite case and DO keep values, because after a
      // delete the document and its versions are gone.
      for (const key of Object.keys(doc ?? {})) {
        if (skip(key)) continue
        changes[key] = { from: null, to: '[created — see the document]' }
      }
    }

    await write(req, {
      user: req.user?.id ?? null,
      userEmail: req.user?.email ?? null,
      operation,
      collectionSlug,
      documentId: String(doc.id),
      documentLabel: labelFor(doc),
      changedFields: Object.keys(changes),
      changes,
      context: contextOf(req, { status: doc._status ?? null }),
    })

    return doc
  }

export const auditDelete =
  (collectionSlug: string, redact: string[] = []): CollectionAfterDeleteHook =>
  async ({ doc, req, id }) => {
    const skip = (key: string) => NEVER_DIFF.has(key) || redact.includes(key)
    // The last known state, because after this the document is gone and its version
    // history goes with it.
    const deleted = flatten(doc ?? {}, '', {}, 'from', 0, skip)

    await write(req, {
      user: req.user?.id ?? null,
      userEmail: req.user?.email ?? null,
      operation: 'delete',
      collectionSlug,
      documentId: String(id),
      documentLabel: labelFor(doc),
      changedFields: Object.keys(deleted),
      changes: deleted,
      context: contextOf(req),
    })

    return doc
  }

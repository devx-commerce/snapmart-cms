import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  PayloadRequest,
  RequiredDataFromCollectionSlug,
} from 'payload'

/**
 * Writes the audit trail. See src/collections/AuditLog.ts for why this exists at all
 * (Payload's versions record what and when, but carry no user column).
 *
 * The naive implementation -- diffing every key of `doc` against `previousDoc` with
 * JSON.stringify -- produces an unusable log, and it is what the available community
 * plugins do. Two reasons:
 *
 *   `updatedAt` differs on every single save, so every entry claims a change that no human
 *   made. A log where every row contains noise is a log nobody reads.
 *
 *   Computed fields (`resolvedDetail`, `templateApplied`) are not stored -- they are
 *   produced on read. They would appear and disappear from diffs depending on which hook
 *   ran, recording changes that never happened.
 *
 * So the diff is explicitly scoped, and anything skipped is named here rather than
 * silently dropped.
 */

/** Never meaningful as a "change a person made". */
const NEVER_DIFF = new Set([
  'id',
  'updatedAt',
  'createdAt',
  // Computed on read, never stored — see src/collections/ProductContent.ts
  'resolvedDetail',
  'templateApplied',
  // Payload's own version bookkeeping
  '_status_old',
])

/** Best-effort human label so a deleted document is still identifiable in the trail. */
const labelFor = (doc: Record<string, unknown>): string | undefined => {
  for (const key of ['title', 'marketingName', 'name', 'slug', 'medusaProductId', 'email']) {
    const v = doc?.[key]
    if (typeof v === 'string' && v) return v
  }
  return undefined
}

/**
 * Reduce a populated relationship back to its id before comparing.
 *
 * `doc` and `previousDoc` do not hydrate relationships to the same depth: after an update,
 * `doc.contentTemplate` may be the full template object while `previousDoc.contentTemplate`
 * is still the id `3`. Comparing them raw reports a change to a field nobody touched --
 * observed here as:
 *
 *     contentTemplate  from: 3  to: "[2366 bytes ...]"
 *
 * on an update that only altered two text fields. This is the single biggest source of
 * false positives in an audit log, and it is what makes a naive diff unusable: once
 * editors see changes they know they did not make, they stop trusting the whole trail.
 */
const normalise = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalise)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // A populated relationship or upload: identified by carrying an id and nothing that
    // looks like authored content alongside it.
    if ('id' in obj && ('createdAt' in obj || 'updatedAt' in obj)) return obj.id
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, normalise(v)]))
  }
  return value
}

/**
 * Deep-compare by serialisation, after normalising relationships. Adequate because Payload
 * documents are plain JSON, and it correctly treats a reordered blocks array as a change
 * (it is one).
 */
const differs = (a: unknown, b: unknown): boolean =>
  JSON.stringify(normalise(a)) !== JSON.stringify(normalise(b))

/**
 * A blocks array or rich-text tree serialises to something far too large to store on every
 * edit. Recording that the field changed, plus its size, keeps the log useful without
 * turning it into a second copy of the database -- the full before/after is already
 * recoverable from Payload's version history, which is what versions are good at.
 */
const summarise = (value: unknown): unknown => {
  const json = JSON.stringify(value)
  if (json && json.length > 1000) {
    return Array.isArray(value)
      ? `[${value.length} item(s), ${json.length} bytes — see version history]`
      : `[${json.length} bytes — see version history]`
  }
  return value ?? null
}

const contextOf = (req: PayloadRequest, extra: Record<string, unknown> = {}) => ({
  ip:
    req.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers?.get('x-real-ip') ??
    null,
  userAgent: req.headers?.get('user-agent') ?? null,
  ...extra,
})

type Diff = Record<string, { from: unknown; to: unknown }>

const write = async (
  req: PayloadRequest,
  // Typed against the generated collection rather than Record<string, unknown> -- the
  // loose type makes TypeScript fall through to payload.create's draft overload and
  // report a confusing "Property 'draft' is missing".
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

    const skip = (key: string) => NEVER_DIFF.has(key) || redact.includes(key)
    const changes: Diff = {}

    if (operation === 'update' && previousDoc) {
      for (const key of new Set([...Object.keys(doc ?? {}), ...Object.keys(previousDoc)])) {
        if (skip(key)) continue
        if (differs(doc?.[key], previousDoc[key])) {
          changes[key] = {
            from: summarise(normalise(previousDoc[key])),
            to: summarise(normalise(doc?.[key])),
          }
        }
      }
      // Nothing a person would recognise as a change — do not write a row.
      if (Object.keys(changes).length === 0) return doc
    } else {
      for (const [key, value] of Object.entries(doc ?? {})) {
        if (skip(key)) continue
        changes[key] = { from: null, to: summarise(normalise(value)) }
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
    await write(req, {
      user: req.user?.id ?? null,
      userEmail: req.user?.email ?? null,
      operation: 'delete',
      collectionSlug,
      documentId: String(id),
      documentLabel: labelFor(doc),
      changedFields: Object.keys(doc ?? {}).filter(
        (k) => !NEVER_DIFF.has(k) && !redact.includes(k),
      ),
      // The last known state, because after this the document is gone and the version
      // history goes with it.
      changes: Object.fromEntries(
        Object.entries(doc ?? {})
          .filter(([k]) => !NEVER_DIFF.has(k) && !redact.includes(k))
          .map(([k, v]) => [k, { from: summarise(normalise(v)), to: null }]),
      ),
      context: contextOf(req),
    })

    return doc
  }

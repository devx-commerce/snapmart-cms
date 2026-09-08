import type { CollectionAfterReadHook, CollectionBeforeValidateHook, PayloadRequest } from 'payload'

type Block = Record<string, unknown> & { blockType: string }
type TemplateDoc = {
  id: number | string
  strategy?: 'resolveAtRead' | 'copyOnCreate'
  layout?: Block[]
}

/**
 * Two ways to give a whole kind of page the same layout. They are opposites, and which one
 * is right depends entirely on whether editors must be able to break the shared sections.
 *
 *   A. copyOnCreate  -- the template's blocks are written into the document once, at
 *                       creation. The document owns them from then on and can edit anything.
 *                       Later template edits do NOT reach existing documents.
 *
 *   B. resolveAtRead -- the document never stores the shared blocks. They are spliced in on
 *                       every read. Editing the template changes every document at once,
 *                       and no document can edit a shared section.
 *
 * B is the one the PDP case wants: thousands of products, common shipping/membership/returns
 * sections, and a change that has to reach all of them.
 */

/**
 * Resolve the template once per request. Without this a 50-product listing is 50 template
 * lookups; with it, one per distinct template. Keyed on the request so nothing leaks
 * between requests, and on (id, depth) because the same template at a different depth is a
 * different payload.
 */
const templateCache = new WeakMap<PayloadRequest, Map<string, TemplateDoc | null>>()

/**
 * The depth the caller asked for, so blocks spliced in by this hook are hydrated to the
 * same level as the rest of the response.
 */
const requestedDepth = (req: PayloadRequest): number => {
  const raw = req.query?.depth
  const parsed = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 5)) : 1
}

/**
 * Always loads the template itself, even when Payload has already populated the
 * relationship on the document.
 *
 * Reusing the pre-populated object looks like the obvious optimisation and is a trap: a
 * relationship Payload populated at document-depth N contains its own relationships at
 * depth N-1, so the spliced-in blocks come back hydrated to a different level than the
 * caller asked for -- and non-monotonically. Measured on this schema before the fix:
 *
 *   depth=0 -> contentTemplate was an id, so the hook fetched at a fixed depth 1 and the
 *              nested reusable-content source came back FULL
 *   depth=1 -> contentTemplate was pre-populated, its nested source was left as an id
 *   depth=2 -> both FULL
 *
 * So `?depth=0` returned MORE data than `?depth=1`. Loading explicitly at the requested
 * depth costs one cached query and makes the response predictable.
 */
const loadTemplate = async (req: PayloadRequest, ref: unknown): Promise<TemplateDoc | null> => {
  if (!ref) return null

  const id = typeof ref === 'object' ? (ref as TemplateDoc).id : ref
  if (id === undefined || id === null) return null

  const depth = requestedDepth(req)
  const key = `${id}@${depth}`

  let cache = templateCache.get(req)
  if (!cache) {
    cache = new Map()
    templateCache.set(req, cache)
  }
  if (cache.has(key)) return cache.get(key) ?? null

  const doc = (await req.payload
    .findByID({ collection: 'page-templates', id: String(id), depth, req })
    .catch(() => null)) as TemplateDoc | null

  cache.set(key, doc)
  return doc
}

/**
 * Splice a document's own blocks into the template's layout wherever a `documentSlot`
 * marker sits. A slot with nothing to put in it disappears rather than leaving a gap.
 */
const spliceSlots = (templateLayout: Block[], slots: Record<'main' | 'extra', Block[]>): Block[] =>
  templateLayout.flatMap((block) => {
    if (block.blockType !== 'documentSlot') return [block]
    const slot = (block.slot as 'main' | 'extra') ?? 'main'
    return slots[slot] ?? []
  })

/**
 * Strategy B. Adds a computed `resolvedDetail` alongside the stored fields; the stored
 * `productDetail` is left untouched, so the document is never written to.
 */
export const resolveTemplateAtRead =
  (ownFieldName: string, outputFieldName: string): CollectionAfterReadHook =>
  async ({ doc, req, context }) => {
    if (context?.skipTemplateResolution) return doc

    const template = await loadTemplate(req, doc.contentTemplate)

    if (!template?.layout || template.strategy !== 'resolveAtRead') {
      // No template, or a copy-on-create one that already wrote its blocks into the doc.
      doc[outputFieldName] = doc[ownFieldName] ?? []
      doc.templateApplied = null
      return doc
    }

    doc[outputFieldName] = spliceSlots(template.layout, {
      main: (doc[ownFieldName] as Block[]) ?? [],
      extra: (doc.templateOverrides as Block[]) ?? [],
    })
    doc.templateApplied = { id: template.id, strategy: template.strategy }
    return doc
  }

/**
 * Strategy A. On create only, copies a copy-on-create template's blocks into the document's
 * own field. Runs once; afterwards the document is ordinary and the template is inert.
 */
export const copyTemplateOnCreate =
  (ownFieldName: string): CollectionBeforeValidateHook =>
  async ({ data, operation, req }) => {
    if (operation !== 'create' || !data) return data

    const template = await loadTemplate(req, data.contentTemplate)
    if (!template?.layout || template.strategy !== 'copyOnCreate') return data

    const existing = (data[ownFieldName] as Block[]) ?? []
    data[ownFieldName] = spliceSlots(template.layout, { main: existing, extra: [] }).map(
      // Drop ids so Payload treats these as new rows rather than trying to move the
      // template's own rows into this document.
      ({ id: _id, ...rest }) => rest,
    )
    return data
  }

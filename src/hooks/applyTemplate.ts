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

/** Resolve the template once per request, whatever depth the caller asked for. */
const templateCache = new WeakMap<PayloadRequest, Map<string, TemplateDoc | null>>()

const loadTemplate = async (req: PayloadRequest, ref: unknown): Promise<TemplateDoc | null> => {
  if (!ref) return null
  // depth >= 1 already populated it
  if (typeof ref === 'object') return ref as TemplateDoc

  const key = String(ref)
  let cache = templateCache.get(req)
  if (!cache) {
    cache = new Map()
    templateCache.set(req, cache)
  }
  if (cache.has(key)) return cache.get(key) ?? null

  const doc = (await req.payload
    .findByID({ collection: 'page-templates', id: key, depth: 1, req })
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

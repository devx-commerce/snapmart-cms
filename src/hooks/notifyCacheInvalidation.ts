import type { CollectionAfterChangeHook, Payload } from 'payload'

/**
 * The worked example of a third-party integration.
 *
 * It fires a webhook on publish. That is the same touch-point any outward integration
 * uses -- a CRM sync, an analytics event, a search reindex, a CDN purge -- so what is being
 * demonstrated is the mechanism, not this particular consumer.
 *
 * It also solves a real problem Phases 2 and 3 created. Both sharing mechanisms deliberately
 * avoid writing to consuming documents:
 *
 *   - editing a reusable-content document changes every document referencing it
 *   - editing a page template changes every document using it
 *
 * ...and in neither case does any consumer's `updatedAt` move. That is the whole point at
 * catalogue scale, but it means **a cache keyed on the consumer will serve stale content
 * forever**. So when a shared document changes, this hook resolves who depends on it and
 * names them in the payload, rather than announcing only the row that changed.
 *
 * Nothing is invalidated here -- the receiver decides. In production that is the BFF's
 * revalidation endpoint and/or a CloudFront invalidation.
 */

type Affected = { collection: string; id: number | string; key?: string }

/** Documents using a given page template. */
const consumersOfTemplate = async (payload: Payload, id: number | string): Promise<Affected[]> => {
  const [pages, products] = await Promise.all([
    payload.find({
      collection: 'pages',
      where: { contentTemplate: { equals: id } },
      depth: 0,
      limit: 500,
    }),
    payload.find({
      collection: 'product-content',
      where: { contentTemplate: { equals: id } },
      depth: 0,
      limit: 500,
    }),
  ])

  return [
    ...pages.docs.map((d) => ({ collection: 'pages', id: d.id, key: d.slug as string })),
    ...products.docs.map((d) => ({
      collection: 'product-content',
      id: d.id,
      key: d.medusaProductId as string,
    })),
  ]
}

/**
 * Documents whose rendered output depends on a reusable-content document.
 *
 * The dependency is TRANSITIVE and the direct query alone is wrong. A product can reference
 * a reusable-content document two ways:
 *
 *   directly    product.productDetail[] -> reusableContent -> source
 *   through a   product.contentTemplate -> template.layout[] -> reusableContent -> source
 *   template
 *
 * The second is the normal case once Phase 3's templates are in use -- the shared membership
 * panel lives in the PDP template, not on each product. Querying only the direct path
 * announced 1 affected document where 3 were actually stale, which is worse than announcing
 * nothing: it looks like it worked.
 */
const consumersOfReusableContent = async (
  payload: Payload,
  id: number | string,
): Promise<Affected[]> => {
  const [pages, products, templates] = await Promise.all([
    payload.find({
      collection: 'pages',
      where: { 'layout.source': { equals: id } },
      depth: 0,
      limit: 500,
    }),
    payload.find({
      collection: 'product-content',
      where: { 'productDetail.source': { equals: id } },
      depth: 0,
      limit: 500,
    }),
    // …and every template that embeds it
    payload.find({
      collection: 'page-templates',
      where: { 'layout.source': { equals: id } },
      depth: 0,
      limit: 500,
    }),
  ])

  const direct: Affected[] = [
    ...pages.docs.map((d) => ({ collection: 'pages', id: d.id, key: d.slug as string })),
    ...products.docs.map((d) => ({
      collection: 'product-content',
      id: d.id,
      key: d.medusaProductId as string,
    })),
  ]

  const viaTemplates = (
    await Promise.all(templates.docs.map((t) => consumersOfTemplate(payload, t.id)))
  ).flat()

  // A document reachable both ways must only be announced once.
  const seen = new Set<string>()
  return [...direct, ...viaTemplates].filter((a) => {
    const key = `${a.collection}/${a.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const notifyCacheInvalidation =
  (collection: string): CollectionAfterChangeHook =>
  async ({ doc, previousDoc, req, operation }) => {
    const url = process.env.CACHE_WEBHOOK_URL
    if (!url) return doc

    // Only published transitions matter to a public cache. A draft save changes nothing a
    // visitor can see, and firing on every autosave (375ms) would be a denial of service
    // against our own webhook receiver.
    const isPublished = doc?._status === 'published'
    const wasPublished = previousDoc?._status === 'published'
    if (!isPublished && !wasPublished) return doc

    let affected: Affected[] = [{ collection, id: doc.id, key: doc.slug ?? doc.medusaProductId }]

    // A shared document does not move its consumers' updatedAt, so name them explicitly.
    if (collection === 'reusable-content') {
      affected = [...affected, ...(await consumersOfReusableContent(req.payload, doc.id))]
    } else if (collection === 'page-templates') {
      affected = [...affected, ...(await consumersOfTemplate(req.payload, doc.id))]
    }

    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.CACHE_WEBHOOK_SECRET
            ? { 'X-Snapmart-Signature': process.env.CACHE_WEBHOOK_SECRET }
            : {}),
        },
        body: JSON.stringify({
          event: `${collection}.${operation}`,
          changed: { collection, id: doc.id },
          affected,
          at: new Date().toISOString(),
        }),
      })
    } catch (error) {
      // Never fail an editor's save because a downstream consumer is unreachable. In
      // production this belongs on a retry queue rather than a log line.
      req.payload.logger.error(
        { err: error, collection, id: doc.id },
        'cache-invalidation webhook failed',
      )
    }

    return doc
  }

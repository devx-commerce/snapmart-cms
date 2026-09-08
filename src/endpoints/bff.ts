import type { Endpoint } from 'payload'

/**
 * GET /api/bff/product-content/:medusaProductId
 *
 * The shape the BFF actually wants: one call, keyed by the id it already has from Medusa,
 * returning the finished layout rather than the raw authored fields.
 *
 * It exists to show two things a generic collection endpoint cannot:
 *   - lookup by a business key instead of Payload's numeric id, so the BFF never has to
 *     hold a Payload id at all;
 *   - a response trimmed to what the storefront renders, instead of every stored field.
 *
 * Note what is NOT here: no price, no stock, no canonical product name. Those come from
 * Medusa and the BFF merges them.
 */
export const bffProductContent: Endpoint = {
  path: '/bff/product-content/:medusaProductId',
  method: 'get',
  handler: async (req) => {
    const { medusaProductId } = req.routeParams as { medusaProductId: string }

    const { docs } = await req.payload.find({
      collection: 'product-content',
      where: { medusaProductId: { equals: medusaProductId } },
      depth: 2,
      limit: 1,
      req,
    })

    const doc = docs[0]
    if (!doc) {
      return Response.json(
        { error: `No content for medusaProductId "${medusaProductId}".` },
        { status: 404 },
      )
    }

    return Response.json({
      medusaProductId: doc.medusaProductId,
      marketingName: doc.marketingName,
      shortDescription: doc.shortDescription ?? null,
      heroImage:
        doc.heroImage && typeof doc.heroImage === 'object'
          ? { url: doc.heroImage.url, alt: doc.heroImage.alt, sizes: doc.heroImage.sizes }
          : null,
      // The template's shared sections with this product's own blocks spliced in.
      layout: doc.resolvedDetail ?? doc.productDetail ?? [],
      meta: {
        template: doc.templateApplied ?? null,
        updatedAt: doc.updatedAt,
      },
    })
  },
}

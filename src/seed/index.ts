import type { Payload } from 'payload'

import { paragraph } from './lexical'

/**
 * Deterministic fixture data, so every phase's queries are reproducible from a clean
 * database. Idempotent: it deletes what it owns before recreating it.
 *
 * Deliberately shaped around the two questions this POC exists to answer:
 *   - one reusable-content document referenced from BOTH a page and a product, so
 *     "author once, use in many collection types" has something to demonstrate;
 *   - two products sharing one template, so layout inheritance has something to
 *     demonstrate (Phase 3 extends this).
 */
export const seed = async (payload: Payload): Promise<Record<string, unknown>> => {
  const wipe = async (collection: 'pages' | 'product-content' | 'reusable-content') => {
    await payload.delete({ collection, where: { id: { exists: true } } })
  }

  await wipe('pages')
  await wipe('product-content')
  await wipe('reusable-content')

  // ---- the content authored once ----
  const membership = await payload.create({
    collection: 'reusable-content',
    data: {
      title: 'Landers Membership Benefits',
      content: [
        {
          blockType: 'richText',
          content: paragraph(
            'Landers members get exclusive warehouse pricing, free delivery over PHP 3,000, and early access to Flash Sales.',
          ),
        },
        {
          blockType: 'cta',
          heading: 'Not a member yet?',
          body: 'Join in-store or online and start saving on your first basket.',
          label: 'Become a member',
          href: '/membership',
        },
      ],
      _status: 'published',
    },
  })

  // ---- consumer 1: a page ----
  const page = await payload.create({
    collection: 'pages',
    data: {
      title: 'About Landers',
      slug: 'about-landers',
      layout: [
        {
          blockType: 'hero',
          heading: 'Landers Superstore — membership that pays for itself',
          subheading: 'One card, every warehouse.',
          alignment: 'left',
        },
        { blockType: 'reusableContent', source: membership.id, useSourceValues: true },
      ],
      _status: 'published',
    },
  })

  // ---- consumers 2 and 3: two products, a DIFFERENT collection type ----
  const productData = [
    {
      medusaProductId: 'prod_01JCOLDBREW1L',
      marketingName: 'Landers Signature Cold Brew 1L',
      shortDescription: 'Smooth, low-acid cold brew in a resealable 1L bottle.',
      detail: 'Cold-pressed for 18 hours, then flash-chilled.',
    },
    {
      medusaProductId: 'prod_01JOLIVEOIL500',
      marketingName: 'Landers Extra Virgin Olive Oil 500ml',
      shortDescription: 'First cold pressing, single origin.',
      detail: 'Harvested and pressed within six hours to keep the polyphenols intact.',
    },
  ]

  const products = []
  for (const p of productData) {
    products.push(
      await payload.create({
        collection: 'product-content',
        data: {
          medusaProductId: p.medusaProductId,
          marketingName: p.marketingName,
          shortDescription: p.shortDescription,
          productDetail: [
            { blockType: 'richText', content: paragraph(p.detail) },
            { blockType: 'reusableContent', source: membership.id, useSourceValues: true },
          ],
          _status: 'published',
        },
      }),
    )
  }

  return {
    reusableContent: { id: membership.id, title: membership.title },
    page: { id: page.id, slug: page.slug },
    products: products.map((p) => ({ id: p.id, medusaProductId: p.medusaProductId })),
  }
}

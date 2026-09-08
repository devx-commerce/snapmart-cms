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
  const wipe = async (
    collection: 'pages' | 'product-content' | 'reusable-content' | 'page-templates',
  ) => {
    await payload.delete({ collection, where: { id: { exists: true } } })
  }

  await wipe('pages')
  await wipe('product-content')
  await wipe('reusable-content')
  await wipe('page-templates')

  // ---- the content authored once ----
  const membership = await payload.create({
    context: { skipAudit: true },
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

  // ---- the PDP layout, authored once for every product ----
  //
  // Note what this template contains: shared sections, a reusable-content reference (so
  // Phase 2's mechanism composes inside Phase 3's), and two slots saying where each
  // product's own content goes.
  const pdpTemplate = await payload.create({
    context: { skipAudit: true },
    collection: 'page-templates',
    data: {
      name: 'Standard PDP',
      appliesTo: 'product-content',
      strategy: 'resolveAtRead',
      layout: [
        // 1. the product's own detail sections
        { blockType: 'documentSlot', slot: 'main' },
        // 2..4 the sections every product shares
        {
          blockType: 'richText',
          content: paragraph(
            'Shipping & Delivery — same-day delivery within Metro Manila for orders placed before 2pm. Standard delivery 2-3 business days nationwide.',
          ),
        },
        { blockType: 'reusableContent', source: membership.id, useSourceValues: true },
        {
          blockType: 'richText',
          content: paragraph(
            'Returns — unopened items can be returned to any Landers warehouse within 30 days with your member card.',
          ),
        },
        // 5. room for the one product that needs something extra
        { blockType: 'documentSlot', slot: 'extra' },
      ],
      _status: 'published',
    },
  })

  // ---- a copy-on-create template, for contrast (Strategy A) ----
  const campaignTemplate = await payload.create({
    context: { skipAudit: true },
    collection: 'page-templates',
    data: {
      name: 'Campaign Landing (starting point)',
      appliesTo: 'pages',
      strategy: 'copyOnCreate',
      layout: [
        {
          blockType: 'hero',
          heading: 'Campaign headline goes here',
          subheading: 'Replace this — it is only a starting point.',
          alignment: 'center',
        },
        { blockType: 'documentSlot', slot: 'main' },
        {
          blockType: 'cta',
          heading: 'Shop the campaign',
          body: 'Edit or delete this block; it belongs to the page now.',
          label: 'Shop now',
          href: '/shop',
        },
      ],
      _status: 'published',
    },
  })

  // ---- consumer 1: a page ----
  const page = await payload.create({
    context: { skipAudit: true },
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
        context: { skipAudit: true },
        collection: 'product-content',
        data: {
          medusaProductId: p.medusaProductId,
          marketingName: p.marketingName,
          shortDescription: p.shortDescription,
          // Both products point at the SAME template. Neither stores the shared
          // sections -- those are spliced in on read.
          contentTemplate: pdpTemplate.id,
          productDetail: [{ blockType: 'richText', content: paragraph(p.detail) }],
          _status: 'published',
        },
      }),
    )
  }

  return {
    reusableContent: { id: membership.id, title: membership.title },
    page: { id: page.id, slug: page.slug },
    templates: {
      pdp: { id: pdpTemplate.id, strategy: 'resolveAtRead' },
      campaign: { id: campaignTemplate.id, strategy: 'copyOnCreate' },
    },
    products: products.map((p) => ({ id: p.id, medusaProductId: p.medusaProductId })),
  }
}

import type { CollectionConfig } from 'payload'

import { authenticated, authenticatedOrPublished } from '../access'
import { contentBlockSlugs } from '../blocks'
import { rejectCommerceFields } from '../hooks/rejectCommerceFields'

/**
 * 1P product content enrichment -- what the SoW gives Payload on p.114: "marketing name,
 * description, hero image, SEO meta", joined with the Medusa base product record at
 * render time.
 *
 * This exists as a SECOND, differently-shaped collection on purpose. Without it, neither
 * "reuse the same content across collection types" (Phase 2) nor the PDP template case
 * (Phase 3) can be demonstrated at all -- both need two unlike collections.
 *
 * The commerce boundary is enforced, not just documented: `rejectCommerceFields` throws on
 * any write carrying price/stock/name. And the display field is `marketingName`, never
 * `name` -- Payload owns the marketing name, Medusa owns the canonical one.
 */
export const ProductContent: CollectionConfig = {
  slug: 'product-content',
  labels: { singular: 'Product Content', plural: 'Product Content' },
  admin: {
    useAsTitle: 'marketingName',
    defaultColumns: ['marketingName', 'medusaProductId', '_status', 'updatedAt'],
    description:
      'Editorial enrichment for a Medusa product. Price, stock and the canonical product name live in Medusa and are rejected here.',
  },
  access: {
    read: authenticatedOrPublished,
    create: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  hooks: {
    beforeValidate: [rejectCommerceFields],
  },
  versions: {
    drafts: { autosave: { interval: 375 } },
    maxPerDoc: 20,
  },
  fields: [
    {
      name: 'medusaProductId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      label: 'Medusa product ID',
      admin: {
        position: 'sidebar',
        description: 'The join key to Medusa. The only commerce identifier Payload stores.',
      },
    },
    {
      name: 'marketingName',
      type: 'text',
      required: true,
      label: 'Marketing name',
      admin: {
        description:
          'Editorial display copy. NOT the canonical product name -- that stays in Medusa.',
      },
    },
    { name: 'shortDescription', type: 'textarea' },
    { name: 'heroImage', type: 'upload', relationTo: 'media' },
    {
      name: 'productDetail',
      type: 'blocks',
      label: 'Product detail sections',
      admin: {
        description:
          'Sections unique to this product. Sections shared across every product come from its template (Phase 3).',
      },
      // v3 API -- see note in src/blocks/index.ts. v4 merges these into `blocks`.
      blockReferences: [...contentBlockSlugs],
      blocks: [],
    },
  ],
}

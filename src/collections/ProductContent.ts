import type { CollectionConfig } from 'payload'
import { authenticated, authenticatedOrPublished } from '../access'
import { layoutBlockSlugs } from '../blocks'
import { copyTemplateOnCreate, resolveTemplateAtRead } from '../hooks/applyTemplate'
import { notifyCacheInvalidation } from '../hooks/notifyCacheInvalidation'
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
    beforeValidate: [rejectCommerceFields, copyTemplateOnCreate('productDetail')],
    // Adds a computed `resolvedDetail` -- the template's shared sections with this
    // product's own blocks spliced into the slots. `productDetail` is never rewritten,
    // so a template edit changes every product without touching a single document.
    afterRead: [resolveTemplateAtRead('productDetail', 'resolvedDetail')],
    afterChange: [notifyCacheInvalidation('product-content')],
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
      name: 'contentTemplate',
      type: 'relationship',
      relationTo: 'page-templates',
      label: 'Page template',
      filterOptions: () => ({ appliesTo: { equals: 'product-content' } }),
      admin: {
        position: 'sidebar',
        description:
          'The layout shared by this kind of product page. Its sections are resolved on read — edit the template to change every product using it.',
      },
    },
    {
      name: 'templateOverrides',
      type: 'blocks',
      label: 'Extra sections',
      admin: {
        description:
          "Fills the template's 'Extra' slot. For the one product that needs something the shared layout does not provide.",
        condition: (data) => Boolean(data?.contentTemplate),
      },
      blockReferences: [...layoutBlockSlugs],
      blocks: [],
    },
    {
      // Reports which template resolved this document and under which strategy, so a
      // consumer can cache-key or log on it. Declared for the same reason as
      // `resolvedDetail` below: a hook-attached field is invisible to GraphQL and to the
      // generated types until it exists in the config.
      name: 'templateApplied',
      type: 'json',
      virtual: true,
      admin: { hidden: true, readOnly: true },
    },
    {
      // Declared so it exists in the GraphQL schema and the generated types. `virtual: true`
      // keeps it out of Postgres entirely -- nothing is stored, no table is created; the
      // afterRead hook fills it on every read.
      //
      // WITHOUT this declaration the template resolution is invisible to GraphQL: a field
      // that only exists because a hook attached it to the returned object is not part of
      // the schema, so it cannot be queried. REST returns it either way, which makes the
      // gap easy to miss.
      name: 'resolvedDetail',
      type: 'blocks',
      virtual: true,
      label: 'Resolved layout (computed)',
      admin: {
        hidden: true,
        readOnly: true,
        description: "The template's shared sections with this product's own blocks spliced in.",
      },
      blockReferences: [...layoutBlockSlugs],
      blocks: [],
    },
    {
      name: 'productDetail',
      type: 'blocks',
      label: 'Product detail sections',
      admin: {
        description:
          'Sections unique to this product. Sections shared across every product come from its template (Phase 3).',
      },
      // v3 API -- see note in src/blocks/index.ts. v4 merges these into `blocks`.
      blockReferences: [...layoutBlockSlugs],
      blocks: [],
    },
  ],
}

import type { CollectionConfig } from 'payload'

import { authenticated, authenticatedOrPublished } from '../access'
import { templateBlockSlugs } from '../blocks'

/**
 * A named layout applied to a whole *kind* of document.
 *
 * The PDP case from the brief: every product page carries the same shipping, membership and
 * returns sections; only the product's own detail differs. Rather than rebuilding those
 * sections on each of thousands of products, they are authored here once and the product
 * documents point at this.
 *
 * `layout` may contain `documentSlot` markers saying where the document's own content is
 * spliced in. Everything before and after a marker is the shared part.
 *
 * `appliesTo` scopes a template to one collection so a PDP template cannot be selected on
 * an editorial page.
 */
export const PageTemplates: CollectionConfig = {
  slug: 'page-templates',
  labels: { singular: 'Page Template', plural: 'Page Templates' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'appliesTo', 'strategy', 'updatedAt'],
    description:
      'Layouts shared by a whole kind of page. Add a Document Slot block where each page’s own content should appear.',
  },
  access: {
    read: authenticatedOrPublished,
    create: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  versions: { drafts: true, maxPerDoc: 20 },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'appliesTo',
      type: 'select',
      required: true,
      options: [
        { label: 'Pages', value: 'pages' },
        { label: 'Product Content', value: 'product-content' },
      ],
      admin: { position: 'sidebar' },
    },
    {
      name: 'strategy',
      type: 'select',
      required: true,
      defaultValue: 'resolveAtRead',
      options: [
        { label: 'Resolve at read — documents stay in sync', value: 'resolveAtRead' },
        { label: 'Copy on create — documents diverge freely', value: 'copyOnCreate' },
      ],
      admin: {
        position: 'sidebar',
        description:
          'Resolve at read: editing this template changes every document using it, and they cannot edit the shared sections. Copy on create: new documents get these blocks as a starting point and own them from then on.',
      },
    },
    {
      name: 'layout',
      type: 'blocks',
      required: true,
      blockReferences: [...templateBlockSlugs],
      blocks: [],
    },
  ],
}

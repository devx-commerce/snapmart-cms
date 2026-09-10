import type { CollectionConfig } from 'payload'
import { authenticated, authenticatedOrPublished } from '../access'
import { contentBlockSlugs } from '../blocks'
import { notifyCacheInvalidation } from '../hooks/notifyCacheInvalidation'

/**
 * A piece of content authored ONCE and referenced from many documents, in any collection.
 *
 * This is the half of "author once, use everywhere" that `blockReferences` does not solve.
 * `blockReferences` shares a block's *schema*; this shares a block's *content*. An editor
 * writes "Landers Membership Benefits" here, and a page, a PDP, and a landing page all
 * point at it. Change it once, every consumer changes.
 *
 * Consumed via the `reusableContent` block (src/blocks/ReusableContent), which also offers
 * a copy-on-write escape hatch for documents that need to diverge.
 */
export const ReusableContent: CollectionConfig = {
  slug: 'reusable-content',
  labels: { singular: 'Reusable Content', plural: 'Reusable Content' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'updatedAt'],
    description: 'Content authored once and referenced from documents in any collection.',
  },
  access: {
    read: authenticatedOrPublished,
    create: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  hooks: {
    afterChange: [notifyCacheInvalidation('reusable-content')],
  },
  versions: { drafts: { schedulePublish: true }, maxPerDoc: 20 },
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'content',
      type: 'blocks',
      required: true,
      // The same four shared blocks. Deliberately does NOT include `reusableContent`
      // itself -- reusable content nesting inside reusable content is a cycle waiting to
      // happen, and nothing in the SoW asks for it.
      blockReferences: [...contentBlockSlugs],
      blocks: [],
    },
  ],
}

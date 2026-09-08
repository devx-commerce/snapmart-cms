import type { Block } from 'payload'

import { contentBlockSlugs } from '../index'

/**
 * Drops a piece of reusable content into any document's layout.
 *
 * Two modes, chosen per placement by `useSourceValues`:
 *
 *   checked (default) -- LIVE LINK. Nothing is copied. The document stores only the
 *     relationship, and rendering resolves through to the source. Editing the source
 *     changes every consumer at once, with no write to any consuming document.
 *
 *   unchecked -- COPY-ON-WRITE. The `ContentManager` UI field replays the source's blocks
 *     into this block's own `content` field, after which the copy is this document's and
 *     diverges freely. The source can change without affecting it.
 *
 * Ported from payloadcms/reusable-content-example (an official Payload repo).
 */
export const ReusableContentBlock: Block = {
  slug: 'reusableContent',
  interfaceName: 'ReusableContentBlock',
  labels: { singular: 'Reusable Content', plural: 'Reusable Content' },
  fields: [
    {
      name: 'source',
      type: 'relationship',
      relationTo: 'reusable-content',
      required: true,
      label: 'Reusable content',
    },
    {
      name: 'useSourceValues',
      type: 'checkbox',
      defaultValue: true,
      label: 'Stay in sync with the source',
      admin: {
        description:
          'On: renders the source live, so edits there appear here. Off: takes a one-time copy you can edit independently.',
        condition: (_data, siblingData) => Boolean(siblingData?.source),
      },
    },
    {
      name: 'content',
      type: 'blocks',
      label: 'Local copy',
      admin: {
        condition: (_data, siblingData) => siblingData?.useSourceValues === false,
      },
      blockReferences: [...contentBlockSlugs],
      blocks: [],
    },
    {
      // Not stored. Watches the checkbox and copies the source's blocks into `content`
      // when it is unticked, and clears them when it is re-ticked.
      name: 'contentManager',
      type: 'ui',
      admin: {
        components: {
          Field: { path: '@/blocks/ReusableContent/ContentManager#ContentManager' },
        },
      },
    },
  ],
}

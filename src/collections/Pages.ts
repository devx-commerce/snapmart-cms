import type { CollectionConfig } from 'payload'

import { anyone, authenticated, authenticatedOrPublished } from '../access'
import { contentBlockSlugs } from '../blocks'

/**
 * A general editorial content type -- the SoW's "custom pages" and Module 13 informational
 * pages (About Us, Careers, FAQ, Contact Us).
 *
 * Drafts are on. The SoW never mentions drafts, versioning or preview anywhere; this POC
 * turns them on to find out what they cost, and the finding goes in the report.
 */
export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', '_status', 'updatedAt'],
  },
  access: {
    read: authenticatedOrPublished,
    create: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  versions: {
    drafts: { autosave: { interval: 375 } },
    maxPerDoc: 20,
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { position: 'sidebar', description: 'URL path segment, e.g. "about-us".' },
    },
    {
      name: 'layout',
      type: 'blocks',
      label: 'Page layout',
      // v3 API: reference shared blocks by slug; `blocks` must be present and empty.
      // v4 removes `blockReferences` and takes these slugs in `blocks` directly.
      blockReferences: [...contentBlockSlugs],
      blocks: [],
    },
  ],
}

export { anyone }

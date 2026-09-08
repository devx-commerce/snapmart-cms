import type { CollectionConfig } from 'payload'

import { anyone, authenticated, authenticatedOrPublished } from '../access'
import { layoutBlockSlugs } from '../blocks'
import { copyTemplateOnCreate } from '../hooks/applyTemplate'

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
  hooks: {
    // Strategy A: a copy-on-create template seeds a new page's layout once, then gets out
    // of the way. Editors can change anything; later template edits do not reach this page.
    beforeValidate: [copyTemplateOnCreate('layout')],
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
      name: 'contentTemplate',
      type: 'relationship',
      relationTo: 'page-templates',
      label: 'Start from template',
      filterOptions: () => ({ appliesTo: { equals: 'pages' } }),
      admin: {
        position: 'sidebar',
        description: 'Copied into the layout below when the page is first created.',
      },
    },
    {
      name: 'layout',
      type: 'blocks',
      label: 'Page layout',
      // v3 API: reference shared blocks by slug; `blocks` must be present and empty.
      // v4 removes `blockReferences` and takes these slugs in `blocks` directly.
      blockReferences: [...layoutBlockSlugs],
      blocks: [],
    },
  ],
}

export { anyone }

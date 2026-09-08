import type { CollectionConfig } from 'payload'
import { anyone, authenticated } from '../access'
import { auditChange, auditDelete } from '../hooks/auditLog'

/**
 * Uploads. `imageSizes` exist so Phase 4 can check whether the S3/CDN adapter uploads
 * derivatives alongside the original, or only the original.
 */
export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: anyone,
    create: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  hooks: {
    afterChange: [auditChange('media')],
    afterDelete: [auditDelete('media')],
  },
  upload: {
    imageSizes: [
      { name: 'thumbnail', width: 300, height: 300, position: 'centre' },
      { name: 'card', width: 768, height: 512, position: 'centre' },
      { name: 'hero', width: 1920, height: undefined, position: 'centre' },
    ],
    focalPoint: true,
    mimeTypes: ['image/*'],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      admin: { description: 'Accessibility text. Required.' },
    },
  ],
}

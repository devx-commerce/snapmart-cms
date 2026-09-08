import { redirectsPlugin } from '@payloadcms/plugin-redirects'
import { seoPlugin } from '@payloadcms/plugin-seo'
import type { GenerateTitle } from '@payloadcms/plugin-seo/types'
import type { Plugin } from 'payload'

import { storagePlugin } from './storage'

/**
 * Two plugins are installed, both because the SoW names the need. The point is to prove the
 * plugin mechanism and measure what a plugin costs, not to assemble a CMS.
 *
 * See docs/feasibility/05-plugins.md for the ones deliberately NOT installed and why --
 * that list is the more useful output.
 */

/** SEO meta is explicitly Payload-owned in the SoW ownership matrix (p.114). */
const seo: Plugin = seoPlugin({
  collections: ['pages', 'product-content'],
  uploadsCollection: 'media',
  tabbedUI: true,
  generateTitle: (({ doc }) =>
    `${doc?.title ?? doc?.marketingName ?? 'Snapmart'} | Landers Superstore`) as GenerateTitle,
  generateDescription: ({ doc }) => doc?.shortDescription ?? '',
})

/**
 * Magento -> new-platform URL mapping. The SoW never addresses it, but a replatform that
 * changes every URL without redirects loses its search rankings, so someone will need this.
 */
const redirects: Plugin = redirectsPlugin({
  collections: ['pages', 'product-content'],
  overrides: {
    admin: {
      description:
        'Old URL -> new URL. Populate from the Magento URL map before cutover so search rankings survive the replatform.',
    },
  },
})

export const plugins: Plugin[] = [storagePlugin, seo, redirects]

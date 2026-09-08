import { redirectsPlugin } from '@payloadcms/plugin-redirects'
import { seoPlugin } from '@payloadcms/plugin-seo'
import type { GenerateTitle } from '@payloadcms/plugin-seo/types'
import type { Plugin } from 'payload'

import { auditLogPlugin } from './audit-log'
import { storagePlugin } from './storage'
import { cacheControlPlugin } from './storage-cache-control'

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

/**
 * Audits every collection except the ones named. Opt-out rather than opt-in, so a
 * collection added later is audited by default rather than silently missed.
 */
const auditLog: Plugin = auditLogPlugin({
  // `users` is excluded because auditing it makes login take MINUTES.
  // Every login writes to the user's `sessions` array, which fires afterChange, which
  // writes an audit row inside the login's own transaction. Measured: login went from
  // ~50ms to 5 minutes. See docs/feasibility/08-audit-logs.md.
  // Auditing role changes is still wanted -- the fix is to audit only the fields that
  // matter on this collection, not to give up on it. Tracked as an open item.
  exclude: ['users'],
})

export const plugins: Plugin[] = [
  storagePlugin,
  // MUST follow storagePlugin: it appends an afterChange hook that runs against the
  // uploaded object, which does not exist until the storage adapter's own hook has run.
  cacheControlPlugin('media'),
  seo,
  redirects,
  auditLog,
]

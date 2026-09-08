import type { CollectionConfig, Config, Plugin } from 'payload'

import { AuditLog } from './collection'
import { auditChange, auditDelete } from './hooks'

export type AuditLogPluginOptions = {
  /**
   * Collections to leave out. Everything else is audited.
   *
   * Opt-OUT, not opt-in, and deliberately so: an audit log with an opt-in list develops
   * silent gaps every time someone adds a collection and forgets. A missing entry looks
   * exactly like "nothing happened", which is the one failure mode that defeats the point.
   * Payload's own internal collections are always excluded and do not need listing.
   */
  exclude?: string[]
  /**
   * Field names never written into the diff, on any collection.
   *
   * The audit log stores old and new values, so a field holding a secret would turn the
   * trail into a secrets store — and one that is deliberately hard to delete from.
   */
  redact?: string[]
  /** Set false to disable entirely, e.g. in tests. */
  enabled?: boolean
}

/** Payload's own bookkeeping. Auditing these produces noise, and the log itself recurses. */
const ALWAYS_EXCLUDED = [
  'audit-log',
  'payload-kv',
  'payload-locked-documents',
  'payload-preferences',
  'payload-migrations',
  'payload-jobs',
]

const DEFAULT_REDACT = ['password', 'salt', 'hash', 'apiKey', 'resetPasswordToken', 'secret']

/**
 * Records who changed which field, when — across every collection, automatically.
 *
 * This is an ordinary Payload plugin: a function that receives the config and returns a
 * modified one. It needs no build step and no publishing. Drop the folder into any Payload
 * repo and add one line to `plugins`.
 *
 *   plugins: [auditLogPlugin({ exclude: ['media'] })]
 *
 * Payload has no native audit log — its versions record what a document looked like and
 * when, but carry no user column at all. See docs/feasibility/08-audit-logs.md.
 */
export const auditLogPlugin =
  (options: AuditLogPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig

    const excluded = new Set([...ALWAYS_EXCLUDED, ...(options.exclude ?? [])])
    const redact = options.redact ?? DEFAULT_REDACT

    const collections: CollectionConfig[] = (incomingConfig.collections ?? []).map((collection) => {
      if (excluded.has(collection.slug)) return collection

      return {
        ...collection,
        hooks: {
          ...collection.hooks,
          // Appended, so a collection's own hooks still run. Order matters: auditing runs
          // last, after any hook that might modify the document.
          afterChange: [
            ...(collection.hooks?.afterChange ?? []),
            auditChange(collection.slug, redact),
          ],
          afterDelete: [
            ...(collection.hooks?.afterDelete ?? []),
            auditDelete(collection.slug, redact),
          ],
        },
      }
    })

    return {
      ...incomingConfig,
      collections: [...collections, AuditLog],
    }
  }

export type { AuditLogPluginOptions as AuditLogOptions }
export { AuditLog }

import type { Access, FieldAccess } from 'payload'

/** Public read. The BFF (snapmart-frontend ADR 0006) calls Payload unauthenticated. */
export const anyone: Access = () => true

/** Any logged-in CMS user. */
export const authenticated: Access = ({ req: { user } }) => Boolean(user)

/**
 * Logged-in users see everything; the public sees published documents only.
 * This is what makes drafts safe to expose on a public endpoint.
 */
export const authenticatedOrPublished: Access = ({ req: { user } }) => {
  if (user) return true
  return { _status: { equals: 'published' } }
}

export const authenticatedFieldAccess: FieldAccess = ({ req: { user } }) => Boolean(user)

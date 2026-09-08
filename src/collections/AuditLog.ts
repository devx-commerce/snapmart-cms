import type { CollectionConfig } from 'payload'

import { authenticated } from '../access'

/**
 * Who changed what, when.
 *
 * Payload has no native audit log. Its `versions` feature stores a full snapshot of the
 * document at each save, which answers *what it looked like* and *when* -- but the version
 * tables carry no user column at all, so it cannot answer *who*. Verified against the
 * running schema: `_product_content_v` has `created_at`, `latest`, `autosave` and the
 * version_* payload, and nothing identifying an author.
 *
 * An official Audit Logs feature exists but is part of Payload's paid Enterprise offering.
 *
 * THREE PROPERTIES MAKE THIS AN AUDIT LOG RATHER THAN A CHANGE FEED
 *
 * 1. It is immutable. Nobody -- including an admin -- can create, edit or delete an entry
 *    through the API or the panel. Entries are written by the hook using `overrideAccess`,
 *    which is the only path in. An audit trail an administrator can quietly edit is not
 *    evidence of anything.
 *
 * 2. It denormalises the actor. `userEmail` is copied in at write time rather than only
 *    holding a relationship, so deleting a user does not erase who made the change. The
 *    relationship is kept as well, for filtering while the user still exists.
 *
 * 3. It records the field-level diff, not just that "something changed".
 */
export const AuditLog: CollectionConfig = {
  slug: 'audit-log',
  labels: { singular: 'Audit Log', plural: 'Audit Log' },
  admin: {
    useAsTitle: 'summary',
    defaultColumns: ['createdAt', 'userEmail', 'operation', 'collectionSlug', 'documentId'],
    description:
      'Immutable record of every content change: who, what, when, and the before/after of each field. Entries cannot be edited or deleted.',
  },
  access: {
    // Tighten this to specific roles before production -- an audit trail readable by
    // everyone is an information-disclosure surface of its own.
    read: authenticated,
    // No API or panel path to write, amend or remove an entry. The hook writes with
    // overrideAccess: true, which bypasses these deliberately and is the only way in.
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  timestamps: true,
  fields: [
    {
      name: 'summary',
      type: 'text',
      admin: { readOnly: true },
      // A readable one-liner so the list view is scannable without opening rows.
      hooks: {
        beforeChange: [
          ({ data }) =>
            `${data?.userEmail ?? 'system'} ${data?.operation ?? '?'} ${data?.collectionSlug ?? '?'}/${data?.documentId ?? '?'}`,
        ],
      },
    },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true, description: 'Null for system operations (seeds, migrations).' },
    },
    {
      name: 'userEmail',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description: 'Captured at write time so the trail survives the user being deleted.',
      },
    },
    {
      name: 'operation',
      type: 'select',
      required: true,
      index: true,
      options: [
        { label: 'Create', value: 'create' },
        { label: 'Update', value: 'update' },
        { label: 'Delete', value: 'delete' },
      ],
      admin: { readOnly: true },
    },
    { name: 'collectionSlug', type: 'text', required: true, index: true, admin: { readOnly: true } },
    { name: 'documentId', type: 'text', required: true, index: true, admin: { readOnly: true } },
    {
      name: 'documentLabel',
      type: 'text',
      admin: {
        readOnly: true,
        description: "The document's title at the time, so a deleted document is still identifiable.",
      },
    },
    {
      name: 'changedFields',
      type: 'text',
      hasMany: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'Field names only — queryable without parsing the diff.',
      },
    },
    {
      name: 'changes',
      type: 'json',
      admin: {
        readOnly: true,
        description: 'Per field: { from, to }. On create, the created values. On delete, the last known values.',
      },
    },
    {
      name: 'context',
      type: 'json',
      admin: { readOnly: true, description: 'IP, user agent, and whether the change was an autosave.' },
    },
  ],
}

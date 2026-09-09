import type { CollectionConfig } from 'payload'

import { authenticated } from '../access'

/**
 * CMS users. The `role` options are the six admin roles the SoW names
 * (01-entities-and-parties.md): "Content Manager, CS Agent, Operations/Fulfilment,
 * Finance, IT/Engineering, Leadership -- RBAC-governed".
 *
 * The SoW never says whether those are Medusa roles, Payload roles, or both, and never maps
 * them to collection permissions. Modelled here as a field so the question is visible; the
 * POC does not attempt the full RBAC matrix.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email', defaultColumns: ['email', 'role'] },
  auth: {
    // Phase 4 compares this against public read access for the BFF's own calls.
    useAPIKey: true,
    tokenExpiration: 60 * 60 * 24 * 30, // 30 days
  },
  access: {
    read: authenticated,
    create: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'contentManager',
      options: [
        { label: 'Content Manager', value: 'contentManager' },
        { label: 'CS Agent', value: 'csAgent' },
        { label: 'Operations / Fulfilment', value: 'operations' },
        { label: 'Finance', value: 'finance' },
        { label: 'IT / Engineering', value: 'engineering' },
        { label: 'Leadership', value: 'leadership' },
      ],
      admin: {
        description:
          'The six admin roles named in the SoW. Not yet wired to per-collection permissions.',
      },
    },
  ],
}

import type { Endpoint } from 'payload'

import { seed } from '../seed'

/**
 * POST /api/seed -- rebuilds the fixture data. Authenticated only.
 * Exists so every phase's evidence is reproducible from a clean database.
 */
export const seedEndpoint: Endpoint = {
  path: '/seed',
  method: 'post',
  handler: async (req) => {
    if (!req.user) {
      return Response.json({ error: 'Authentication required.' }, { status: 401 })
    }

    const result = await seed(req.payload)
    return Response.json({ seeded: true, ...result })
  },
}

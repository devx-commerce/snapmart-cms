import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import sharp from 'sharp'

import { contentBlocks, DocumentSlot } from './blocks'
import { ReusableContentBlock } from './blocks/ReusableContent/config'
import { AuditLog } from './collections/AuditLog'
import { Media } from './collections/Media'
import { Pages } from './collections/Pages'
import { PageTemplates } from './collections/PageTemplates'
import { ProductContent } from './collections/ProductContent'
import { ReusableContent } from './collections/ReusableContent'
import { Users } from './collections/Users'
import { bffProductContent } from './endpoints/bff'
import { seedEndpoint } from './endpoints/seed'
import { plugins } from './plugins'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: { titleSuffix: ' — Snapmart CMS' },
  },

  // Every shared content component is defined ONCE, here. Collections reference them by
  // slug rather than redeclaring them, which is the config-level half of "author once,
  // use everywhere". See src/blocks/index.ts for the v3-vs-v4 API note.
  blocks: [...contentBlocks, ReusableContentBlock, DocumentSlot],

  collections: [Pages, ProductContent, ReusableContent, PageTemplates, Media, Users, AuditLog],

  // No globals. This is a POC: header/footer/site-settings would demonstrate nothing that
  // the collections above do not already demonstrate.

  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL || '' },
  }),
  endpoints: [seedEndpoint, bffProductContent],
  sharp,
  plugins,
})

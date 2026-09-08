import { CopyObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { CollectionAfterChangeHook, Config, Plugin } from 'payload'

/**
 * Sets Cache-Control on uploaded media.
 *
 * `@payloadcms/storage-s3` has no CacheControl option — verified, there is no such key
 * anywhere in its option type. Objects therefore arrive with no cache header at all.
 *
 * With CloudFront in front that is survivable: the distribution applies its own cache
 * policy and the browser is told what the CDN says. Serving straight from S3 there is no
 * such layer, so a missing header means the browser revalidates every image on every page
 * view. Two costs: pages feel slow, and every view is a billed S3 GET.
 *
 * Payload's filenames already carry the dimensions of each derivative
 * (`landers-hero-768x512.png`), so a long max-age is safe for the sizes. The original keeps
 * a shorter one because re-uploading a file with the same name replaces it in place —
 * filenames are not content-hashed, which is tracked as an open item.
 *
 * Implemented as CopyObject onto itself with MetadataDirective REPLACE, which is the
 * supported way to change metadata on an existing object. One extra call per upload; none
 * on read.
 *
 * ORDERING MATTERS, and getting it wrong fails in a way that looks like a permissions
 * problem. Declaring this hook inline on the Media collection put it BEFORE the storage
 * adapter's own upload hook, so it ran against an object that did not exist yet and every
 * call returned `NoSuchKey: The specified key does not exist`. It is therefore a plugin,
 * registered AFTER storagePlugin — plugins are applied in array order and each appends to
 * the hooks array, so this one lands last.
 */

const LONG = 'public, max-age=31536000, immutable' // derivatives — dimensions in the name
const SHORT = 'public, max-age=86400' // original — same name can be re-uploaded

let client: S3Client | undefined

const s3 = (): S3Client => {
  if (!client) {
    const creds =
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined
    client = new S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
      ...(process.env.S3_FORCE_PATH_STYLE === 'true' ? { forcePathStyle: true } : {}),
      ...(creds ? { credentials: creds } : {}),
    })
  }
  return client
}

export const setCacheControl: CollectionAfterChangeHook = async ({ doc, req, operation }) => {
  const bucket = process.env.S3_BUCKET
  if (!bucket || operation === 'update') return doc

  // The original plus every imageSize derivative.
  const keys: { key: string; cacheControl: string }[] = [
    ...(doc.filename ? [{ key: String(doc.filename), cacheControl: SHORT }] : []),
    ...Object.values(doc.sizes ?? {})
      .map((size) => (size as { filename?: string })?.filename)
      .filter((f): f is string => Boolean(f))
      .map((filename) => ({ key: filename, cacheControl: LONG })),
  ]

  await Promise.all(
    keys.map(({ key, cacheControl }) =>
      s3()
        .send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: key,
            CopySource: `${bucket}/${key}`,
            MetadataDirective: 'REPLACE',
            CacheControl: cacheControl,
            ContentType: doc.mimeType ?? undefined,
          }),
        )
        .catch((error) => {
          // Never fail an editor's upload because the cache header could not be set — the
          // file is already stored and serving. Loud, because silently uncached media is
          // exactly the problem this exists to prevent.
          req.payload.logger.error({ err: error, key }, 'could not set Cache-Control on media')
        }),
    ),
  )

  return doc
}

/**
 * Registers the hook. MUST come after `storagePlugin` in the plugins array, or the objects
 * will not exist yet when it runs.
 */
export const cacheControlPlugin =
  (collectionSlug = 'media'): Plugin =>
  (incomingConfig: Config): Config => ({
    ...incomingConfig,
    collections: (incomingConfig.collections ?? []).map((collection) =>
      collection.slug === collectionSlug
        ? {
            ...collection,
            hooks: {
              ...collection.hooks,
              afterChange: [...(collection.hooks?.afterChange ?? []), setCacheControl],
            },
          }
        : collection,
    ),
  })

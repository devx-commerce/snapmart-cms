import { s3Storage } from '@payloadcms/storage-s3'
import type { Plugin } from 'payload'

/**
 * Media on S3, served through a CDN.
 *
 * The same code path serves three environments and the only difference is environment
 * variables:
 *
 *   local     MinIO      S3_ENDPOINT set, S3_FORCE_PATH_STYLE=true, static keys
 *   AWS (dev) real S3    no endpoint, no path style, static IAM user keys
 *   AWS (EKS) real S3    no endpoint, no keys at all -- the pod's IRSA role supplies them
 *
 * The two settings that matter, and why:
 *
 *   disablePayloadAccessControl: true
 *     Payload stops proxying file bytes through its own /api/media/file/... route. Without
 *     this, every image request hits a Node process on EKS -- which, at HPA min 1 / max 4
 *     (SoW pp.145-146), is exactly what the CMS pods must not be doing. With it, Payload
 *     stores the file and hands out a URL pointing somewhere else entirely.
 *     The trade-off is real: access control no longer applies to the file bytes. Anyone
 *     with the URL can fetch it. Correct for public marketing media, wrong for anything
 *     private, which needs signedDownloads instead.
 *
 *   generateFileURL
 *     Overrides the URL written onto the media document. By default the adapter emits the
 *     bucket endpoint; this emits CDN_BASE_URL. Locally that is MinIO; in AWS it is the
 *     CloudFront distribution domain in front of the bucket.
 *
 * The SoW never mentions CloudFront, an S3 bucket, or any media pipeline for Payload (only
 * the SAP/Mirakl price-and-stock ingestion, which is unrelated). This is a proposal.
 */

const {
  S3_BUCKET,
  S3_ENDPOINT,
  S3_REGION,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_FORCE_PATH_STYLE,
  CDN_BASE_URL,
} = process.env

/**
 * Static keys are passed ONLY when both are present.
 *
 * Passing `credentials: { accessKeyId: '', secretAccessKey: '' }` does not mean "no
 * credentials" to the AWS SDK -- it means "these empty credentials", which disables the
 * default provider chain and fails with an opaque signature error. On EKS the pod's IRSA
 * role is picked up by that chain, so hard-coding the object here would break exactly the
 * deployment the SoW describes, and only there.
 */
const credentials =
  S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
    ? { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY }
    : undefined

export const storagePlugin: Plugin = s3Storage({
  enabled: Boolean(S3_BUCKET),
  bucket: S3_BUCKET ?? '',
  collections: {
    media: {
      disablePayloadAccessControl: true,
      generateFileURL: ({ filename, prefix }) => {
        const base = (CDN_BASE_URL ?? '').replace(/\/$/, '')
        const key = prefix ? `${prefix}/${filename}` : filename
        return `${base}/${key}`
      },
    },
  },
  config: {
    // Only MinIO (or another S3-compatible store) needs an explicit endpoint. Left unset
    // for real S3 so the SDK derives the regional endpoint itself.
    ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT } : {}),
    // Path-style addressing is a MinIO requirement. Real S3 uses virtual-hosted style, and
    // forcing path style there breaks TLS certificate matching on some regions.
    ...(S3_FORCE_PATH_STYLE === 'true' ? { forcePathStyle: true } : {}),
    ...(credentials ? { credentials } : {}),
    region: S3_REGION ?? 'us-east-1',
  },
  // No `acl` is set on purpose. Setting one fails on buckets with Object Ownership =
  // "Bucket owner enforced", which is the default for new buckets. Public read access
  // should come from a bucket policy or CloudFront OAC, not per-object ACLs.
})

import { s3Storage } from '@payloadcms/storage-s3'
import type { Plugin } from 'payload'

/**
 * Media on S3, served through a CDN.
 *
 * The two settings that matter, and why:
 *
 *   disablePayloadAccessControl: true
 *     Payload stops proxying file bytes through its own /api/media/file/... route. Without
 *     this, every image request hits a Node process on EKS -- which, at HPA min 1 / max 4
 *     (SoW pp.145-146), is exactly what the CMS pods must not be doing. With it, Payload
 *     stores the file and hands out a URL that points somewhere else entirely.
 *     The trade-off is real: access control no longer applies to the file bytes. Anyone
 *     with the URL can fetch it. That is correct for public marketing media and wrong for
 *     anything private, which would need signedDownloads instead.
 *
 *   generateFileURL
 *     Overrides the URL written into the `media` document. By default the adapter emits the
 *     bucket endpoint; this emits CDN_BASE_URL instead. Locally that is MinIO; in AWS it is
 *     the CloudFront distribution domain in front of the bucket. Nothing else changes
 *     between the two environments -- one variable.
 *
 * The SoW never mentions CloudFront, an S3 bucket, or any media pipeline for Payload
 * (only for the SAP/Mirakl price-and-stock ingestion, which is unrelated). This is a
 * proposal, not a transcription.
 */
export const storagePlugin: Plugin = s3Storage({
  enabled: Boolean(process.env.S3_BUCKET),
  bucket: process.env.S3_BUCKET ?? '',
  collections: {
    media: {
      disablePayloadAccessControl: true,
      generateFileURL: ({ filename, prefix }) => {
        const base = (process.env.CDN_BASE_URL ?? '').replace(/\/$/, '')
        const key = prefix ? `${prefix}/${filename}` : filename
        return `${base}/${key}`
      },
    },
  },
  config: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    // MinIO needs path-style addressing; real S3 does not. In AWS, drop this and let the
    // SDK use the bucket's virtual-hosted style.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
  },
})

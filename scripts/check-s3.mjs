/**
 * S3 / CDN preflight.
 *
 * Run this BEFORE pointing Payload at a new bucket. It exercises exactly the four
 * operations the storage adapter performs, plus the public read path, and names the
 * missing IAM permission when one fails -- so an AWS problem never gets debugged through
 * Payload's upload pipeline.
 *
 *   pnpm check:s3
 *
 * Reads the same variables as src/plugins/storage.ts. Never prints secret values.
 */

import { readFileSync } from 'node:fs'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

// Load .env without adding a runtime dependency.
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
} catch {
  // no .env — rely on the ambient environment
}

const {
  S3_BUCKET,
  S3_ENDPOINT,
  S3_REGION,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_FORCE_PATH_STYLE,
  CDN_BASE_URL,
} = process.env

const mask = (v) => (v ? `${v.slice(0, 4)}…${v.slice(-2)} (${v.length} chars)` : '(unset)')
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`)

console.log('\nConfiguration')
console.log(`  bucket           ${S3_BUCKET ?? '(unset)'}`)
console.log(`  region           ${S3_REGION ?? '(unset — will default to us-east-1)'}`)
console.log(`  endpoint         ${S3_ENDPOINT ?? '(unset — real AWS S3)'}`)
console.log(
  `  path style       ${S3_FORCE_PATH_STYLE === 'true' ? 'forced (MinIO)' : 'virtual-hosted (AWS)'}`,
)
console.log(`  access key id    ${mask(S3_ACCESS_KEY_ID)}`)
console.log(
  `  secret key       ${S3_ACCESS_KEY_ID ? (S3_SECRET_ACCESS_KEY ? 'set' : '\x1b[31mMISSING\x1b[0m') : '(unset — SDK default chain / IAM role)'}`,
)
console.log(`  CDN_BASE_URL     ${CDN_BASE_URL ?? '(unset)'}`)

if (!S3_BUCKET) {
  bad('\nS3_BUCKET is not set. Nothing to check.')
  process.exit(1)
}

const credentials =
  S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
    ? { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY }
    : undefined

const s3 = new S3Client({
  region: S3_REGION ?? 'us-east-1',
  ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT } : {}),
  ...(S3_FORCE_PATH_STYLE === 'true' ? { forcePathStyle: true } : {}),
  ...(credentials ? { credentials } : {}),
})

const key = `_preflight/snapmart-cms-${Date.now()}.txt`
const body = 'snapmart-cms preflight'
let failures = 0

const step = async (label, needs, fn) => {
  try {
    const out = await fn()
    ok(`${label}`)
    return out
  } catch (err) {
    failures++
    bad(`${label} — ${err.name}: ${err.message.split('\n')[0]}`)
    console.log(`      needs IAM: ${needs}`)
    return null
  }
}

console.log('\nS3 operations (the four the storage adapter performs)')
await step('HeadBucket    — bucket exists and is reachable', 's3:ListBucket', () =>
  s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET })),
)
await step('ListObjectsV2 — can enumerate', 's3:ListBucket', () =>
  s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, MaxKeys: 1 })),
)
const put = await step('PutObject     — can upload', 's3:PutObject', () =>
  s3.send(
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: 'text/plain' }),
  ),
)
if (put) {
  await step('GetObject     — can read back', 's3:GetObject', () =>
    s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key })),
  )
}

console.log('\nPublic read path (what a browser does — no credentials)')
if (!CDN_BASE_URL) {
  bad('CDN_BASE_URL is unset, so generateFileURL would emit "/<filename>". Set it.')
  failures++
} else if (!put) {
  console.log('  – skipped: nothing was uploaded to fetch')
} else {
  const url = `${CDN_BASE_URL.replace(/\/$/, '')}/${key}`
  try {
    const res = await fetch(url)
    const text = res.ok ? await res.text() : ''
    if (res.ok && text === body) {
      ok(`GET ${url} → ${res.status}`)
      const cc = res.headers.get('cache-control')
      console.log(`      cache-control: ${cc ?? '(none — CDN will use its own default)'}`)
      console.log(
        `      served by:     ${res.headers.get('server') ?? res.headers.get('via') ?? 'unknown'}`,
      )
    } else {
      failures++
      bad(`GET ${url} → ${res.status} ${res.statusText}`)
      if (res.status === 403)
        console.log(
          '      403 usually means Block Public Access is on and there is no CloudFront OAC,\n' +
            '      or CDN_BASE_URL points at the bucket rather than the distribution.',
        )
      if (res.status === 404)
        console.log(
          '      404 usually means CDN_BASE_URL has the wrong origin path, or the distribution\n' +
            '      has not finished deploying.',
        )
    }
  } catch (err) {
    failures++
    bad(`GET ${url} — ${err.message}`)
  }
}

if (put) {
  console.log('\nCleanup')
  await step('DeleteObject  — can remove', 's3:DeleteObject', () =>
    s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key })),
  )
}

console.log(
  failures === 0
    ? '\n\x1b[32mAll checks passed.\x1b[0m Payload can use this bucket — start it and upload through /admin.\n'
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m Fix these before pointing Payload at the bucket.\n`,
)
process.exit(failures === 0 ? 0 : 1)

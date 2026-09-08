# Switching from MinIO to real S3 / CloudFront

Phase 4 proved the media pipeline against MinIO. This is what changes to point it at AWS,
and what to provision first.

**No code changes are needed.** `src/plugins/storage.ts` is environment-driven; the
difference between local, a dev bucket and an EKS pod is entirely in `.env`.

---

## ⚠️ Do not paste credentials into chat, tickets, or commits

Put them in `.env`, which is gitignored. Nothing needs to read them out again — the code
takes them from the environment, and `pnpm check:s3` masks the key id and never prints the
secret.

If a key has already been pasted somewhere shared, **rotate it** rather than relying on the
message being deleted.

---

## 1. What to provision

### The bucket

A standard private bucket. Take the defaults — in particular **leave Block Public Access
ON** and **leave Object Ownership as "Bucket owner enforced"** (ACLs disabled). The adapter
is configured to set no ACL, precisely so those defaults work.

Suggested name: `snapmart-cms-media-dev` (the bucket name ends up in nothing public, since
CloudFront fronts it).

### IAM: the minimum policy

Payload performs exactly three object operations. `ListBucket` is needed only by the
preflight script's `HeadBucket` check, and is worth including so the check can run.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PayloadObjectAccess",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::snapmart-cms-media-dev/*"
    },
    {
      "Sid": "PayloadBucketCheck",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::snapmart-cms-media-dev"
    }
  ]
}
```

Note the two different resource ARNs — object actions take `/*`, bucket actions do not.
Getting that wrong is the most common cause of a working `PutObject` alongside a failing
`HeadBucket`.

**For local testing:** an IAM user with this policy and an access key.
**For EKS:** an IRSA role with this policy and **no static keys at all** — see §4.

### CloudFront (recommended, but optional for a first test)

Either works, and `CDN_BASE_URL` is the only difference:

| | `CDN_BASE_URL` | Bucket access |
|---|---|---|
| **CloudFront + OAC** *(matches production)* | `https://dxxxxxxxxxxxxx.cloudfront.net` | stays private; OAC lets only the distribution read it |
| **Public bucket** *(quick test only)* | `https://<bucket>.s3.<region>.amazonaws.com` | Block Public Access off + a public-read bucket policy |

The second is faster to stand up but is not what should ship — it makes every object
world-readable directly from S3, with no edge cache and no ability to revoke.

If you use CloudFront: origin = the bucket (the S3 *REST* endpoint, not the website
endpoint), origin access = **Origin Access Control**, and let the console attach the
generated bucket policy. Distributions take ~5–10 minutes to deploy; a 404 before then is
expected.

---

## 2. What to put in `.env`

```bash
S3_BUCKET=snapmart-cms-media-dev
S3_REGION=ap-southeast-1              # match the bucket's actual region
S3_ACCESS_KEY_ID=…                    # from the IAM user
S3_SECRET_ACCESS_KEY=…

# CloudFront distribution domain, or the S3 URL if testing without a CDN.
# No trailing slash.
CDN_BASE_URL=https://dxxxxxxxxxxxxx.cloudfront.net

# Both of these are MinIO-only. DELETE them (or leave them empty) for real AWS.
# S3_ENDPOINT=
# S3_FORCE_PATH_STYLE=
```

**`S3_ENDPOINT` and `S3_FORCE_PATH_STYLE` must be removed, not just changed.** They are
MinIO requirements:

- an endpoint left pointing at `localhost:9000` sends every upload to a container that is
  no longer the target;
- path-style addressing against real S3 breaks TLS certificate matching in several regions,
  producing a confusing handshake error rather than a permissions one.

The config omits both keys entirely when the variables are unset, which is what the SDK
needs in order to derive the regional endpoint itself.

---

## 3. Order of operations

```bash
# 1. Verify AWS in isolation, before Payload is involved at all.
pnpm check:s3

# 2. Only once that passes clean, restart Payload and upload through the panel.
pnpm dev            # then http://localhost:3000/admin → Media → upload

# 3. Confirm the URL Payload stored points at the CDN, and that it serves.
curl -s localhost:3000/api/media?limit=1 | jq -r '.docs[0].url'
curl -I "$(curl -s localhost:3000/api/media?limit=1 | jq -r '.docs[0].url')"
```

`pnpm check:s3` exercises the same four operations the adapter performs, then fetches the
object over `CDN_BASE_URL` with no credentials — the way a browser will. When something
fails it names the missing IAM action, and it distinguishes the two failure modes that look
identical from Payload:

- **403 on the public fetch** → Block Public Access is on with no OAC, or `CDN_BASE_URL`
  points at the bucket instead of the distribution.
- **404 on the public fetch** → wrong origin path, or the distribution is still deploying.

Run it against MinIO first if you want to see a passing baseline — it works there too.

---

## 4. What changes again for EKS

On a pod with an IRSA role, **remove `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`
entirely.** The SDK's default credential chain picks the role up automatically.

This is the reason `storage.ts` only passes a `credentials` object when both variables are
present. Passing `{ accessKeyId: '', secretAccessKey: '' }` does not mean "no credentials"
to the AWS SDK — it means "these empty credentials", which **disables the default chain**
and fails with an opaque signature error. That bug would have appeared only on EKS, which
is the worst place to find it.

---

## 5. Things to check once it is live

These were open questions from Phase 4 that a real bucket can finally answer.

| Check | Why it matters |
|---|---|
| **`Cache-Control` on the object** | The adapter sets none, so the header comes from CloudFront's default. `pnpm check:s3` prints what came back. Media filenames already carry dimensions, so a long `max-age` is appropriate — but it has to be set deliberately, on the distribution or via the upload. |
| **Same-name re-upload** | Filenames are not content-hashed. Re-uploading `hero.png` serves the *old* object from the edge until invalidated. Confirm the behaviour, then decide between hashed filenames and an invalidation on publish. |
| **All four objects, not just the original** | Sharp generates three `imageSizes` derivatives at upload. Check the bucket has four keys per image and that each serves from the CDN. |
| **Invalidation wiring** | `notifyCacheInvalidation` (Phase 5) already resolves which documents went stale. Pointing `CACHE_WEBHOOK_URL` at something that calls `CreateInvalidation` closes the loop — note CloudFront charges beyond 1,000 paths/month, so prefer invalidating by prefix. |
| **Region latency** | The SoW is Philippines-only (landers.ph). `ap-southeast-1` (Singapore) is the nearest region; CloudFront's edge locations matter more than bucket region for reads, but uploads from the admin panel will feel the difference. |

---

## What I need from you

Nothing pasted here. Once the bucket and key exist:

1. Put the five values into `.env` yourself.
2. Run `pnpm check:s3` and paste **the output** — it is safe to share, it masks the key id
   and never prints the secret.

If it passes I will run the full media pipeline against the real bucket and update
[04-apis-and-cdn.md](04-apis-and-cdn.md) and [REPORT.md](REPORT.md) so the CDN section stops
being a proposal and becomes a verified result. If it fails, the output names the cause.

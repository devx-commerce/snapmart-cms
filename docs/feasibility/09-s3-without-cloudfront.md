# S3 without CloudFront — what changes

CloudFront is not available, so S3 must serve the public read itself. That works, and the
same code path handles it — but three things change, and one of them is a real gap in
Payload.

---

## What you need to provision

| # | Thing | How |
|---|---|---|
| 1 | An S3 bucket | `./scripts/provision-s3.sh` (already written) |
| 2 | An IAM user with `PutObject`, `GetObject`, `DeleteObject` on `bucket/*`, plus `ListBucket` on the bucket | same script |
| 3 | **Public read on the bucket** | `./scripts/s3-public-read.sh <bucket>` — **new, and the opposite of what step 1 sets up** |
| 4 | Five values in `.env` | below |

Step 3 exists because `provision-s3.sh` deliberately blocks public access — correct when
CloudFront fronts the bucket with an Origin Access Control, wrong when nothing does.

### What step 3 actually grants

```json
{
  "Sid": "PublicReadObjectsOnly",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::<bucket>/*"
}
```

`s3:GetObject` on objects, to everyone. **Not** `s3:ListBucket` — the bucket cannot be
enumerated, so someone needs the exact key. It also leaves the two ACL blocks ON, so ACLs
stay disabled and access comes from this policy alone.

**Treat everything in this bucket as public.** It is marketing media, which is meant to be
public. Nothing else should go in it.

### `.env`

```bash
S3_BUCKET=snapmart-cms-media-<suffix>
S3_REGION=ap-southeast-1
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…

# No CloudFront, so this is the bucket's own REST endpoint. No trailing slash.
CDN_BASE_URL=https://<bucket>.s3.<region>.amazonaws.com
```

**Delete `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE`** — both are MinIO-only. An endpoint still
pointing at `localhost:9000` sends uploads to a container that is not the target, and forced
path style breaks TLS certificate matching in several regions.

Then, before starting Payload:

```bash
pnpm check:s3     # exercises the four operations, then fetches over CDN_BASE_URL uncredentialed
```

---

## The gap: Payload cannot set `Cache-Control`

`@payloadcms/storage-s3` has **no `CacheControl` option** — verified, the string does not
appear anywhere in its option type or its source. Objects arrive with no cache header at
all.

With CloudFront that is survivable: the distribution applies its own cache policy. Serving
straight from S3 there is no such layer, so **the browser revalidates every image on every
page view**. Two costs, and the second one is a bill:

- pages feel slow, because nothing is cached
- every page view becomes a billed S3 GET plus egress

Fixed by `src/plugins/storage-cache-control.ts`, which sets the header after upload:

```
cache-test-1.png              public, max-age=86400
cache-test-1-300x300.png      public, max-age=31536000, immutable
cache-test-1-768x512.png      public, max-age=31536000, immutable
cache-test-1-1920x960.png     public, max-age=31536000, immutable
```

Derivatives get a year and `immutable` because their filenames carry their dimensions and
never change meaning. The original gets a day, because re-uploading a file with the same
name replaces it in place — **filenames are not content-hashed**, which is the open item
below.

### The ordering trap, worth knowing before you touch this file

Declared as an ordinary hook on the Media collection, it failed on every upload:

```
NoSuchKey: The specified key does not exist.
```

It was running **before** the storage adapter had uploaded anything. A hook declared inline
on a collection sits in the array before hooks that plugins append later.

So it is a plugin, registered **after** `storagePlugin`, since plugins apply in array order
and each appends. The failure mode is worth naming because `NoSuchKey` reads like a
permissions or path problem and sends you looking in entirely the wrong place.

---

## What you give up versus CloudFront

Not blockers for the POC, but they should be on the record before this shape ships.

| | CloudFront + OAC | S3 direct (this) |
|---|---|---|
| Edge caching near Manila | yes | **no** — every miss goes to the bucket's region |
| Bucket stays private | yes | **no** — public-read policy |
| Custom domain + TLS | yes | no — `<bucket>.s3.<region>.amazonaws.com` |
| Cache headers | distribution policy | set per object by our hook |
| Cost per view | cheaper egress, fewer origin hits | billed S3 GET + egress every uncached view |
| Invalidation | `CreateInvalidation` | none — the object *is* the cache |

The latency one matters most here: the SoW is Philippines-only. With CloudFront a Manila
user hits a nearby edge; without it, every uncached request crosses to `ap-southeast-1`
(Singapore) or wherever the bucket lives. Bearable for a POC, worth revisiting before
launch — **CloudFront can be added later without touching any code, by pointing
`CDN_BASE_URL` at the distribution instead of the bucket.** That is the whole change.

---

## Open items this makes more pressing

- **Filenames are not content-hashed.** Re-uploading `hero.png` replaces the object, and
  with no CDN to invalidate, browsers hold the old one for `max-age`. That is why the
  original gets 24h rather than a year. A content hash or a per-upload prefix would let both
  be `immutable`.
- **One extra `CopyObject` per uploaded file.** Four files per image, so four extra calls.
  Negligible at editorial volume; worth knowing before a bulk media import.
- **No invalidation path.** With CloudFront, `notifyCacheInvalidation` could trigger
  `CreateInvalidation`. Without it, the only lever is the object's own `max-age`.

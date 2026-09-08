# Phase 4 — GraphQL, REST, and CDN-backed assets

Answers: *the GraphQL playground and the endpoints for fetching content; and how a CDN is
connected for assets and static content.*

## What Payload exposes, without being asked

From the same collection configs written in Phase 1, and with no extra code:

| Surface | Where | Notes |
|---|---|---|
| REST | `/api/<collection>` | full CRUD, `where`, `sort`, `limit`, `depth`, `draft` |
| GraphQL | `POST /api/graphql` | schema generated from the collections |
| GraphQL Playground | `GET /api/graphql-playground` | dev only by default; renders with Docs + Schema panels |
| Local API | in-process `payload.find(...)` | no HTTP hop — only usable *inside* this Next app, so **not** available to the BFF |
| Custom REST | `endpoints: []` | used here for `/api/seed` and `/api/bff/...` |

## The BFF's endpoint

`GET /api/bff/product-content/:medusaProductId` (`src/endpoints/bff.ts`) — one call, keyed
by the id the BFF already holds from Medusa, returning the finished layout:

```
medusaProductId: prod_01JOLIVEOIL500
marketingName  : Landers Extra Virgin Olive Oil 500ml
template       : {"id":3,"strategy":"resolveAtRead"}
layout         : richText → richText → reusableContent → richText → cta
has price/stock: false
unknown id     : HTTP 404
```

The BFF never has to hold a Payload id, and the response carries no commerce data — the
merge with Medusa stays the BFF's job, as ADR 0006 requires.

## Findings — APIs

### 1. A hook-computed field is invisible to GraphQL unless it is declared

This is the most important finding in the phase, because it silently breaks Phase 3.

`resolvedDetail` (the template's shared sections spliced around the document's own) is
produced by an `afterRead` hook. Over REST it appeared immediately. Over GraphQL it did not
exist at all:

```
{ __type(name: "ProductContent") { fields { name } } }
→ id, medusaProductId, marketingName, shortDescription, heroImage,
  contentTemplate, templateOverrides, productDetail, updatedAt, createdAt, _status
```

GraphQL is schema-driven: a field a hook attaches to the returned object is not part of the
schema and cannot be selected. **A team building against REST would never notice, and the
GraphQL consumer would silently get unresolved pages.**

Fixed by declaring the field with **`virtual: true`**, which puts it in the schema and the
generated types while storing nothing:

```
tables matching 'resolved'                       : 0
columns on product_content matching 'resolved'   : 0
```

After that, GraphQL returns the full resolved PDP:

```
1. RichTextBlock            2. RichTextBlock
3. ReusableContentBlock     4. RichTextBlock
5. CtaBlock "Harvest 2026 is here"     ← from the per-product `extra` slot
```

### 2. …but GraphQL will not populate relationships *inside* a virtual field

A verified limitation, isolated with a control:

| Field | Kind | `reusableContent.source { title }` |
|---|---|---|
| `pages.layout` | real, stored | `{"title":"Landers Membership Benefits"}` |
| `product-content.resolvedDetail` | **virtual** | **`null`** |

Same block type, same relationship, same request — populated in the stored field, `null` in
the virtual one. REST returns it correctly in both.

**Consequence for the BFF decision:** if the storefront needs reusable-content *inside*
template-resolved layouts — which the PDP does — **GraphQL cannot serve it today.** The
options are REST (works now), the custom endpoint above (works now, and is a better shape
anyway), or a custom GraphQL resolver. **Recommend REST + the custom endpoint for the read
path, and treat GraphQL as a convenience for simpler content.**

### 3. `depth` hydration was non-monotonic, and the cause is a trap worth naming

Measured before the fix — `?depth=0` returned **more** data than `?depth=1`:

```
depth=0   3377 bytes   contentTemplate: id   | nested reusable source: FULL
depth=1   3989 bytes   contentTemplate: FULL | nested reusable source: id
depth=2   5719 bytes   contentTemplate: FULL | nested reusable source: FULL
```

Cause: the hook reused the relationship object Payload had already populated when the
caller asked for `depth >= 1`. A relationship populated at document-depth N contains *its*
relationships at depth N−1, so the spliced-in blocks came back hydrated to a different
level than the caller asked for. At `depth=0` the relationship was still an id, so the hook
fetched it itself at a hard-coded depth 1 — and produced more.

Fixed by always loading the template at the caller's requested depth, cached per request:

```
depth=0   2512 bytes   contentTemplate: id   | nested reusable source: id
depth=1   4854 bytes   contentTemplate: FULL | nested reusable source: FULL
depth=2   5719 bytes   contentTemplate: FULL | nested reusable source: FULL
depth=3   5719 bytes   contentTemplate: FULL | nested reusable source: FULL
```

**Generalises beyond this hook:** any hook that composes a response from a related document
must decide its own depth explicitly. Reusing the pre-populated object looks like a free
optimisation and quietly makes payload size unpredictable.

`depth` is the main payload-size lever — **2.3× between 0 and 2 on a document with four
blocks**. On a full PDP with a real block library the ratio will be larger, so the BFF
should ask for the lowest depth it can use.

### 4. Drafts do not leak to anonymous callers — and this decides the BFF's auth mode

With one draft and two published pages:

```
anonymous                    HTTP 200  total 2  holiday-campaign:published, about-landers:published
anonymous + ?draft=true      HTTP 200  total 2  holiday-campaign:published, about-landers:published
API key (BFF service user)   HTTP 200  total 3  draft-only:draft, …
API key + ?draft=true        HTTP 200  total 3  draft-only:draft, …
bad API key                  HTTP 403
```

`?draft=true` from an anonymous caller does **not** override the access function. But an
API-key caller sees drafts on every request, whether or not it asks.

**Recommendation: the BFF's normal read path should be anonymous.** Reach for the API key
only on the preview path. A BFF that authenticates every call will serve unpublished
content to production the first time an editor saves a draft.

Also worth noting: `enableAPIKey: true` over the REST API does **not** mint a key — `apiKey`
comes back `null` and must be supplied explicitly. Only the admin UI generates one.

### 5. GraphQL Playground in production

Enabled in development, disabled in production by default
(`graphQL.disablePlaygroundInProduction`). **Recommend leaving it disabled**, and adding
Payload's documented introspection-blocking `validationRules` so the schema is not
enumerable from the public endpoint either.

## Media and CDN

The SoW never mentions CloudFront, an S3 bucket, or any media pipeline for Payload — every
S3 reference in it belongs to the SAP/Mirakl price-and-stock ingestion, which is unrelated.
**This section is a proposal that has been run, not a transcription.**

`src/plugins/storage.ts` configures `@payloadcms/storage-s3` against MinIO. Two settings do
the work:

- **`disablePayloadAccessControl: true`** — Payload stops proxying file bytes through its
  own `/api/media/file/...` route. Without it every image request wakes a CMS pod, which at
  HPA min 1 / max 4 (SoW pp.145–146) is exactly what those pods must not be doing. The
  trade-off is real and must be a decision: file bytes are then public to anyone with the
  URL. Correct for marketing media, wrong for anything private, which needs `signedDownloads`.
- **`generateFileURL`** — rewrites the URL stored on the media document to `CDN_BASE_URL`
  instead of the bucket endpoint. Locally that is MinIO; in AWS it is the CloudFront
  distribution domain. **One environment variable is the entire difference.**

Note: in Payload **3.88 the adapter is a plugin** (`plugins: [...]`). The top-level
`storage:` key shown in current docs is v4 — using it on v3 silently does nothing.

### Proof

Upload through the REST API, and the URLs Payload hands back:

```
url      : http://localhost:9000/snapmart-cms-media/landers-hero.png
sizes    :
   thumbnail  …/landers-hero-300x300.png
   card       …/landers-hero-768x512.png
   hero       …/landers-hero-1920x960.png
```

All four objects reached the bucket, and all four serve unauthenticated from the CDN host
(`artifacts/04-cdn-delivery.txt`):

```
landers-hero.png            HTTP 200  11625 bytes  image/png
landers-hero-300x300.png    HTTP 200   1048 bytes  image/png
landers-hero-768x512.png    HTTP 200   2542 bytes  image/png
landers-hero-1920x960.png   HTTP 200   8013 bytes  image/png
```

**`imageSizes` derivatives are generated by sharp and uploaded too** — the CDN serves all
three, so the storefront never asks a CMS pod to resize anything.

### Finding: Payload's own file route 500s rather than 404s

With `disablePayloadAccessControl: true`, `/api/media/file/<anything>` returns
**HTTP 500 `{"errors":[{"message":"Something went wrong."}]}`** — for filenames that exist
and filenames that never did. It should 404.

It matters because the Magento migration will carry old media URLs. **Add an explicit 404
or a redirect for `/api/media/file/*` before launch**, or monitoring will fill with 500s
from bookmarks and stale links.

## Recommended production shape

| Concern | Recommendation |
|---|---|
| Read path | **REST**, plus purpose-built `/api/bff/...` endpoints. GraphQL cannot serve template-resolved layouts today (finding 2). |
| Auth | **Anonymous** for the storefront path; API key only for preview (finding 4). |
| Payload size | BFF asks for the **lowest usable `depth`** (finding 3). |
| Bucket | Private bucket, CloudFront OAC in front, `CDN_BASE_URL` = distribution domain. |
| Cache | Long `max-age` on `/media/*` — filenames already carry dimensions. Invalidation in Phase 5. |
| Playground | Disabled in production, plus introspection-blocking `validationRules`. |
| Legacy URLs | Explicit 404/redirect for `/api/media/file/*`. |

## Open questions raised

- **Media filenames are not content-hashed.** Re-uploading a file with the same name serves
  a stale object from the CDN edge until invalidated. Worth adding a hash or a prefix.
- **No `Cache-Control` is set on upload.** The adapter does not set one, so CDN behaviour
  depends on bucket defaults. Should be explicit.
- **Local API is unavailable to the BFF** (different process). Every BFF read is an HTTP
  hop, which is the argument for caching template-resolved responses at the BFF.

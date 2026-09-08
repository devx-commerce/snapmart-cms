# snapmart-cms — PayloadCMS feasibility report

**Verdict: PayloadCMS is a good fit for Snapmart's content layer.** Everything asked for
works, and the two hardest requirements — sharing content across collection types, and page
templates for a whole kind of page — are solved by mechanisms that scale to a catalogue
rather than by copy-paste.

There are four things to decide before production, and one that would silently ship broken.
They are in **[Decisions required](#decisions-required)**.

Built on `payload@3.88.0` / `next@16.3.3` / Postgres 17, running locally against Docker.
Every claim below links to the phase document holding its command and output.

---

## The six questions

### 1. How is schema defined, and how is content authored per collection type?

Schema is **TypeScript, not admin clicks**. A collection is a plain object; the admin panel,
REST API, GraphQL schema, Postgres DDL and TypeScript types are all derived from it. The
content model is reviewable in a pull request and diffable between environments — a real
advantage over Magento's admin-defined attributes.

Four content blocks (`hero`, `richText`, `mediaBlock`, `cta`) are registered **once** at
config root; both collections reference them by slug. Verified in the panel: the same four
blocks appear in the block picker of both `pages` and `product-content`.

→ [01-schema.md](01-schema.md)

**The cost worth knowing:** Postgres gets **one table per block type per collection**, and
enabling drafts doubles it. This POC's 4 blocks × 2 collections took the schema from 9 to 29
tables. Nesting is free (nested blocks share a table via a `_path` column), so the formula is
`block types × collections × 2` at any depth. At the SoW's "21+ content types" with a
realistic block library that is several hundred tables. Payload handles it; the schema stops
being human-readable. **Restrict which blocks each collection accepts rather than passing the
whole library everywhere.**

### 2. GraphQL playground, and the endpoints for fetching content

Playground renders at `/api/graphql-playground` with Docs and Schema panels; the endpoint is
`POST /api/graphql`. REST is at `/api/<collection>` with `where`, `sort`, `depth` and
`draft`. Custom REST endpoints are a few lines — this POC adds
`GET /api/bff/product-content/:medusaProductId`, keyed by the id the BFF already holds from
Medusa and returning the finished layout.

→ [04-apis-and-cdn.md](04-apis-and-cdn.md)

**⚠️ The thing that would ship broken:** a field computed by an `afterRead` hook is
**invisible to GraphQL**. Phase 3's template resolution appeared over REST and did not exist
in the GraphQL schema at all. A team building against REST would never notice, and the
GraphQL consumer would silently render unresolved pages. Fixed by declaring the field
`virtual: true`, which adds it to the schema and the generated types while creating **zero
tables and zero columns**.

**And a limitation that survives the fix:** GraphQL **will not populate relationships inside
a virtual field**. Isolated with a control — the same `reusableContent.source { title }`
resolves in a stored field and returns `null` in a virtual one; REST returns it in both.
**So GraphQL cannot serve template-resolved PDP layouts today.**

### 3. Plugins and third-party integrations

Two installed against real SoW needs: **`plugin-seo`** (SEO meta is Payload-owned, p.114) and
**`plugin-redirects`** (Magento → new URL mapping). Both verified working over REST and
GraphQL.

Deliberately **not** installed, with reasons: `plugin-ecommerce` and `plugin-stripe` would
violate the ownership matrix by giving Payload commerce data; `plugin-multi-tenant` has no
use in a single market; **`plugin-search` is a naming trap** — it indexes Payload content,
while the SoW's product search is MeiliSearch/Algolia fed from Medusa.

Third-party integration has one general answer: **a hook, optionally packaged as a plugin.**
The worked example is an `afterChange` webhook that announces publishes outward. Salesforce,
analytics and search reindexing all attach at the same point.

→ [05-plugins.md](05-plugins.md)

**Installing a plugin is a schema change**, not a dependency bump — `plugin-redirects` added
two tables, `plugin-seo` three columns per collection.

### 4. CDN for assets and static content

`@payloadcms/storage-s3` with two settings doing the work: `disablePayloadAccessControl: true`
stops Payload proxying file bytes through its own route (at HPA min 1 / max 4, CMS pods must
not be serving images), and `generateFileURL` rewrites the stored URL to `CDN_BASE_URL`.
**One environment variable is the entire difference between local MinIO and CloudFront.**

Verified end to end: upload → original plus all three `imageSizes` derivatives in the bucket
→ all four **HTTP 200 unauthenticated from the CDN host**, correct content types and byte
counts. Sharp generates the derivatives at upload, so the storefront never asks a CMS pod to
resize anything.

→ [04-apis-and-cdn.md](04-apis-and-cdn.md)

The SoW never mentions CloudFront, a media bucket, or any Payload asset pipeline — every S3
reference in it belongs to the SAP/Mirakl price-and-stock ingestion. The design is ours, and
**it now runs on real AWS**: private bucket in ap-south-1, CloudFront with an Origin Access
Control, verified Miss → Hit → Hit at the edge with correct Cache-Control on the original and
all three derivatives. See [09-s3-without-cloudfront.md](09-s3-without-cloudfront.md).

### 5. Common content reused across collection types

**Solved, and there are two different problems here.** Conflating them is the mistake worth
avoiding:

- **Shared block *definition*** (`blockReferences`) — one *schema*, many collections. Stops
  the Hero block being redeclared six times.
- **Shared content *instance*** (a `reusable-content` collection + a `reusableContent`
  block) — one *piece of content*, many documents. Stops the membership panel being retyped
  on forty pages.

**Recommendation: live-link by default.** One source edited → all three consumers (one page,
two products, **two different collection types**) showed the new copy, and **every
consumer's `updatedAt` was unchanged**. No fan-out write, no drift, no stale window.

Copy-on-write is available per placement for the document that needs to diverge, verified in
the admin panel. It is one-way — re-linking discards the local copy rather than merging.

→ [02-reusable-content.md](02-reusable-content.md)

### 6. Page templates — marking a layout for a kind of page

**Solved.** Payload has no native template feature; what it gives you is the choice of *when*
the shared layout joins the document, and the two answers are opposites:

| | **A. Copy on create** | **B. Resolve at read** |
|---|---|---|
| Document stores shared blocks | yes | **no** |
| Editor can change a shared section | yes | no |
| Editing the template later | existing documents unaffected | **every** document changes at once |
| Fits | campaign / landing pages | **PDP** |

**Recommendation for the PDP case in the brief: strategy B.** Each product stores **1 block
and renders 4**. Editing the template's returns policy once changed both products, and
**neither product was written to**. At catalogue scale a policy change is one row update
rather than a rewrite of every product.

A `documentSlot` marker in the template says where the product's own detail goes, and a
second `extra` slot is the escape hatch for the one product that needs something the shared
layout does not provide — verified: one product carries a harvest CTA the other does not,
without either leaving the template.

`strategy` is a field on the template, so the choice is made per template rather than
hard-coded per collection. Both are live in this build.

→ [03-templates.md](03-templates.md)

---

## Decisions required

### 1. REST or GraphQL for the storefront read path — **decide before the BFF is built**

GraphQL cannot serve template-resolved PDP layouts today (relationships inside virtual fields
return `null`). **Recommend REST plus purpose-built `/api/bff/...` endpoints**, with GraphQL
as a convenience for simpler content. Revisit if a custom GraphQL resolver is written.

### 2. The BFF must read anonymously, not with an API key

With one draft and two published pages: anonymous `?draft=true` returned **published only**;
the API-key service user saw the draft **whether it asked or not**. A BFF that authenticates
every read will serve unpublished content to production the first time an editor saves a
draft. **Reserve the API key for the preview path.**

### 3. Cache invalidation has to be dependency-aware

Both sharing mechanisms are cheap precisely because they never write to consumers — so no
consumer's `updatedAt` moves when its rendered content changes. **A cache keyed on the
consumer will serve stale content forever.**

The webhook in Phase 5 resolves dependents and names them. It must walk **two levels**: a
product reaches a reusable-content panel *through its template*, not directly. The first
implementation queried only direct references and reported 1 affected document where 3 were
stale — which is worse than reporting nothing, because it looks like it worked.

### 4. Live Preview should be costed alongside templates, not after

Strategy B's cost is the edit form: shared sections are **absent** from it by design, so an
editor sees a fragment rather than the page they are producing. That is correct behaviour and
a bad experience without Live Preview. It is not in the SoW.

---

## Gaps this POC fills that the SoW never decided

Confirmed absent from all seven source documents by exhaustive grep — zero hits.

| Gap | What this POC found |
|---|---|
| **Database engine** | Postgres works. Inferred from the p.147 Aurora diagram, which labels the cluster "(Medusa DB)" — **never actually stated for Payload**. Confirm before provisioning. |
| **REST vs GraphQL** | See decision 1. |
| **Media bucket + CDN** | Proposed and proven: private bucket, CloudFront OAC, `CDN_BASE_URL` = distribution domain. |
| **Drafts / versioning / preview** | Cheap to enable, immediately useful, and drafts do not leak to anonymous callers. **Recommend in scope.** Each opted-in collection doubles its tables. |
| **Scheduled publishing** | Not built. Modellable as a date-window field; no Payload feature needed. |
| **CMS roles** | The SoW's six admin roles are modelled as a field. **Mapping them to per-collection permissions is undone** and needs its own pass. |
| **Localisation** | Not built, not needed — single market. |

## Contradictions to take back to the client

1. **Store Locator ownership.** `04-features-modules-and-scope.md` calls Store Locator and
   Delivery Areas "new PayloadCMS collections" as settled fact, while
   `02-data-ownership-matrix.md` and `05-open-questions-and-risks.md` both list the same
   thing as an open P2 question (PayloadCMS vs Medusa custom fields). Not built here for
   that reason.
2. **Payload hosting.** The final SoW places Payload on EKS (HPA min 1 / max 4, pp.145–146),
   but `00-document-map.md` records Denish still holding an open ECS/Fargate-vs-EKS decision
   that includes "PayloadCMS hosting". Probably resolved by sequence, never explicitly
   reconciled.
3. **"Marketing name" vs "product name".** The SoW gives Payload the *marketing name*
   (p.114); `snapmart-frontend/docs/glossary.md` says Payload "must not hold the product's
   name". Both are right about different fields, and one word was doing both jobs. Resolved
   here in the schema: the field is **`marketingName`**, there is no field called `name`, and
   a write carrying `price`, `stock` or `name` is **rejected with HTTP 400**. Recommend this
   naming carries into the production model and the BFF contract.

## Risks

| Risk | Detail |
|---|---|
| **Table growth** | `block types × collections × 2`. Several hundred tables at full scope. Manageable, but migrations get long and the schema stops being readable. |
| **`blockReferences` → `blocks` in v4** | v3 uses `blockReferences: [...] + blocks: []`; v4 removes it. Every use site is commented. A codemod exists. Payload v4 is currently canary-only. |
| **`afterRead` cost** | Template resolution runs per document read. Cached per request here; production wants a shared cache in front. |
| **Fire-and-forget webhooks** | A dropped invalidation is silent staleness. Needs a retry queue and an idempotent receiver. |
| **`limit: 500` on dependency queries** | A panel used by more than 500 documents is silently under-reported. |
| **The "21+ content types" figure is never enumerated** | The real content model is still unscoped. Nobody can size the build from the SoW alone. |

## Scaffold problems that will hit the production repo

1. **`create-payload-app` ignores `--db-connection-string`** — writes a placeholder into
   `.env` regardless. Breaks any automated provisioning.
2. **pnpm 11 renamed the native-build setting to `allowBuilds`.** Until it is set,
   `pnpm install` **exits 1**, and because `next dev` runs an install preflight the dev
   server refuses to start with a stack trace that never names the cause. The scaffold ships
   the old key. **This will hit CI.**
3. **The scaffold's ESLint has never run** — missing `@eslint/eslintrc`, and adding it
   exposes a `FlatCompat` × `eslint-config-next@16` circular-structure crash. Replaced with
   Biome ported from `snapmart-frontend`.
4. **Turbopack does not reliably hot-reload Payload hook modules.** A correct fix returned
   stale results through several edit cycles until `rm -rf .next` and a restart. Restart
   before concluding your hook is wrong.
5. **`/api/media/file/*` returns 500, not 404**, once `disablePayloadAccessControl` is on —
   and the Magento migration will carry old media URLs.

## What the production build should carry forward

`src/blocks/` (root registration + `blockReferences`), `src/collections/ReusableContent.ts`
with its block and `ContentManager`, `src/collections/PageTemplates.ts` with
`src/hooks/applyTemplate.ts`, `src/hooks/rejectCommerceFields.ts`,
`src/plugins/storage.ts`, `src/endpoints/bff.ts`, and
`src/hooks/notifyCacheInvalidation.ts` — all written to be lifted rather than re-derived.

**Not** carried forward: the collection *set* and the block library. They are the minimum
that answers these six questions, not a content model. The SoW never enumerates its 21+
types, so the real one still has to be designed.

## Reproducing this

```bash
docker compose up -d          # postgres:17 on 5433, minio + bucket
pnpm install && pnpm dev      # http://localhost:3000/admin
# create the first admin user, then:
curl -X POST localhost:3000/api/seed -H "Authorization: JWT <token>"
node scripts/demo-reusable-content.mjs     # one source, three consumers, no writes
node scripts/demo-reusable-divergence.mjs  # copy-on-write divergence
node scripts/demo-page-templates.mjs       # one template, two products, no writes
node scripts/demo-template-override.mjs    # extra slot + copy-on-create
```

`docker compose down -v` and repeat reproduces every result from an empty database.

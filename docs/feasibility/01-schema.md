# Phase 1 — Schema definition and content authoring

Answers: *how do we define the schema, and how does content get added in different
collection types?*

## What was built

**Four content components**, defined once in `src/blocks/index.ts` and registered in the
top-level `blocks` array of `src/payload.config.ts`:

| Block | Fields |
|---|---|
| `hero` | heading, subheading, image (upload), alignment |
| `richText` | content (Lexical) |
| `mediaBlock` | media (upload), caption |
| `cta` | heading, body, button label, button URL |

**Two unlike collections**, both referencing the same four blocks by slug:

| Collection | Purpose | Blocks field |
|---|---|---|
| `pages` | editorial pages — the SoW's "custom pages" and Module 13 informational pages | `layout` |
| `product-content` | 1P enrichment for a Medusa product (SoW p.114) | `productDetail` |

Plus `media` (uploads with three `imageSizes` + focal point, for Phase 4) and `users`
(auth with `useAPIKey`, and a `role` field carrying the SoW's six admin roles).

**No globals.** Header/footer/site-settings would demonstrate nothing the collections above
do not already demonstrate.

## How schema is defined

Schema is TypeScript, not a UI. A collection is a plain object; the admin panel, the REST
API, the GraphQL API, the Postgres DDL and the TypeScript types are all *derived* from it.
Nothing is clicked into existence, so the content model is reviewable in a pull request and
diffable between environments — a genuine advantage over Magento's admin-defined attributes.

```ts
// payload.config.ts — the block is declared ONCE
blocks: [Hero, RichText, MediaBlock, Cta],

// each collection references it by slug, never redeclares it
{
  name: 'layout',
  type: 'blocks',
  blockReferences: [...contentBlockSlugs],  // v3 API
  blocks: [],                               // must be present and empty in v3
}
```

## Proof

**Both collections' block pickers offer the same four blocks** — verified in the admin UI.
Opening *Add Layout* on a `pages` document and *Add Product Detail* on a `product-content`
document each renders Hero / Rich Text / Media / Call to Action from the single root
registration.

Authored through the admin panel and published:

```
$ curl -s /api/pages?depth=0
page            about-landers      | published | blocks: hero

$ curl -s /api/product-content?depth=0
product-content prod_01JCOLDBREW1L | published | blocks: richText
```

Anonymous read works — the shape the BFF needs (`artifacts/01-pages-anonymous.json`):

```
totalDocs = 1 | slug = about-landers | _status = published
```

**Commerce boundary enforced, not just documented**
(`artifacts/01-commerce-boundary-rejection.txt`):

```
$ POST /api/product-content {"medusaProductId":"…","marketingName":"Nope",
                             "price":499,"stock":10,"name":"Canonical"}
HTTP 400
{"errors":[{"message":"Commerce data must not be stored in Payload. Medusa owns these
 fields: price, stock, name. Payload holds editorial content keyed by medusaProductId
 only."}]}
```

The same request without those keys succeeds. This is `src/hooks/rejectCommerceFields.ts`,
enforcing what `snapmart-frontend/docs/glossary.md` states as a rule.

## Findings

### 1. `blockReferences` shares the *config*, not the *storage* — and this is the big one

Table count went **9 → 29** for four blocks across two collections
(`artifacts/01-postgres-tables.txt`):

```
pages_blocks_hero          product_content_blocks_hero
pages_blocks_rich_text     product_content_blocks_rich_text
pages_blocks_media_block   product_content_blocks_media_block
pages_blocks_cta           product_content_blocks_cta
```

`hero` is declared once, but Postgres gets **one table per block type per collection**, and
enabling drafts **doubles all of it** into parallel `_…_v_blocks_*` version tables. Of the
29 tables, 16 are block tables and 10 are version tables.

The growth is `blocks × collections × 2`. The SoW's "21+ content types" with a realistic
10–15 block library projects to **roughly 400–600 tables**. Payload handles it, but it is
a real consideration for the Aurora cluster, for migration runtime, and for anyone who
opens the schema expecting to read it. Two levers exist and should be decided deliberately:
restrict which blocks each collection accepts rather than passing the full set everywhere,
and enable drafts per collection rather than globally.

**Recommendation:** do not give every collection the whole block library by reflex. Both
collections here take all four only because the POC needs to demonstrate sharing.

### 2. `blockReferences` is typed against generated types, so the obvious code does not compile

```ts
export const contentBlockSlugs = contentBlocks.map((b) => b.slug)   // string[] — REJECTED
```

`blockReferences` takes `(Block | BlockSlug)[]` where `BlockSlug = StringKeyOf<TypedBlock>` —
the keys of the generated `Config['blocks']` map, not `string`. Deriving the list from the
block configs widens to `string[]` and fails the typecheck. The slugs have to be written as
literals. `src/blocks/index.ts` therefore keeps a hand-written list plus a compile-time
guard that fails if it drifts from the registered blocks.

### 3. Drafts and autosave are cheap to switch on and immediately useful

`versions: { drafts: { autosave: { interval: 375 } } }` gives draft/published status, a
version history, and autosave. Anonymous reads return published documents only, via the
`authenticatedOrPublished` access function — so drafts are safe to expose on a public
endpoint without a second API.

The SoW never mentions drafts, versioning or preview anywhere. **They should be in scope**;
this is the cheapest capability the POC found.

One consequence worth stating: autosave creates the document as a draft the moment the
create form opens, so `pages/1` exists before the editor types anything.

### 4. Field naming resolves a real contradiction between the SoW and the storefront

The SoW gives Payload the *marketing name* (p.114). `snapmart-frontend/docs/glossary.md`
says Payload "must not hold the product's name". Both are right about different fields, and
one word was doing both jobs.

The collection therefore has **`marketingName`** and no field called `name` — the boundary
hook rejects `name` outright. The distinction lives in the schema rather than in a comment.
**This naming should carry into the production content model and the BFF contract.**

### 5. Validation is enforced by the panel, not just the API

Publishing a `product-content` document with an empty required rich-text field inside a
block produced an inline error naming the exact path: *"Product detail sections > Block 1
(Rich Text) > Content"*. Editors get the same validation the API does.

## Scaffold problems found (both will hit the production repo)

1. **The scaffold's ESLint config does not run.** `eslint.config.mjs` imports
   `@eslint/eslintrc`, which the template does not install. Adding it surfaces a second
   failure — `FlatCompat` wrapping `eslint-config-next@16` throws *"Converting circular
   structure to JSON"*. The template ships a linter that has never run.

   **Resolved by replacing ESLint + Prettier with Biome**, ported from `snapmart-frontend`'s
   `biome.json` (single binary, no plugin resolution, already the sibling repo's choice).
   `pnpm lint` and `pnpm typecheck` both exit 0.

2. **The scaffold's own test helper does not typecheck** once `users` gains a required
   field. `tests/helpers/seedUser.ts` calls `payload.create` with `{email, password}`; with
   `role` required, TypeScript can no longer match the non-draft overload and reports a
   confusing *"Property 'draft' is missing"*. Fixed by seeding `role`.

## Open questions raised

- **Which blocks should each collection actually accept?** Finding 1 makes this a schema
  design decision with a database cost, not a convenience.
- **Drafts on every collection, or only some?** Each one that opts in doubles its tables.
- **Migrations.** Dev pushes schema on boot. Production needs committed `payload migrate`
  files, and an EKS deployment with HPA min 1 / max 4 boots several pods at once — untested
  here, and a real operational question.

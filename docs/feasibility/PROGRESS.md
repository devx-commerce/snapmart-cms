# snapmart-cms — POC progress tracker

PayloadCMS feasibility POC for the Snapmart Magento 2 → Medusa.js v2 migration.
Updated at the end of every phase. Nothing is marked **Done** without its command and output.

| Phase | Title | Status | Evidence |
|---|---|---|---|
| 0 | Repo init + Payload booting on Postgres | ✅ Done | `/api/access` → 200 · 9 tables in Postgres · admin user created through the panel |
| 1 | Schema and content authoring | ✅ Done | [01-schema.md](01-schema.md) · 9→29 tables · boundary write rejected 400 · both collections authored in the panel |
| 2 | Reusable content across collection types | ✅ Done | [02-reusable-content.md](02-reusable-content.md) · 1 source → 3 consumers in 2 collection types, consumers never written · copy-on-write verified in the panel |
| 3 | Page templates / layout inheritance | ✅ Done | [03-templates.md](03-templates.md) · 2 products store 1 block, render 4 · template edit reached both, neither written |
| 4 | GraphQL, REST, and CDN-backed assets | ✅ Done | [04-apis-and-cdn.md](04-apis-and-cdn.md) · playground live · 4 objects served from the CDN host · drafts do not leak to anonymous |
| 5 | Plugins, third-party integration, report | ⏳ In progress | — |

Status values: `⬜ Not started` · `⏳ In progress` · `✅ Done` · `⛔ Blocked`

---

## Phase 0 — Repo init and a booting Payload

**Status:** ✅ Done

### Built

- Scaffolded with `create-payload-app@3.88.0`, blank template, Postgres adapter, pnpm.
- `docker-compose.yml` replaced (the scaffold ships a Mongo-default one): `postgres:17-alpine`
  on host port **5433** (5432 is taken by the host's Homebrew Postgres 17.7), plus `minio`
  and a one-shot `mc` container creating a public-read `snapmart-cms-media` bucket. MinIO
  idles until Phase 4 but is provisioned once, here.
- `.env.example` committed, `.env` generated from it with a real 32-byte `PAYLOAD_SECRET`.
- `.nvmrc` → `22.22.0`, matching `snapmart-frontend`.
- First admin user created **through the admin panel UI**, not seeded.

### Proof

```
$ curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/access
200
```

```
$ psql -h 127.0.0.1 -p 5433 -U snapmart -d snapmart_cms -c '\dt'
 media | payload_kv | payload_locked_documents | payload_locked_documents_rels
 payload_migrations | payload_preferences | payload_preferences_rels
 users | users_sessions
(9 rows)
```

```
$ pnpm generate:types
INFO: Compiling TS types for Collections and Globals...
$ wc -l src/payload-types.ts
338
```

```
$ psql ... -tAc "select id, email from users;"
1|admin@snapmart.local
```

Admin dashboard renders at `http://localhost:3000/admin` showing the Users and Media
collections (verified via browser automation).

### Versions actually installed

`payload@3.88.0` · `next@16.3.3` · `react@19.2.6` · `@payloadcms/db-postgres@3.88.0` ·
`@payloadcms/richtext-lexical@3.88.0` · Node 24.11.1 (local) · pnpm 11.25.0 · Postgres 17.

`next@16.3.3` is what the scaffold pinned; it sits inside Payload's peer range
`>=16.2.6 <17.0.0`. Left as-is rather than bumped to 16.3.4 — no reason to diverge from
what Payload ships and tests against.

### Findings

1. **`create-payload-app` ignores `--db-connection-string`.** Passing `--db postgres
   --db-connection-string ... --db-accept-recommended` still wrote a placeholder
   `postgres://postgres:<password>@127.0.0.1:5432/snapmart-cms` into `.env`. The flag is
   parsed but not applied. `.env` has to be fixed by hand after scaffolding — worth knowing
   before anyone automates provisioning.

2. **pnpm 11 renamed the native-build-approval setting, and it is not cosmetic.** pnpm 11
   replaced `onlyBuiltDependencies` (package.json, then `pnpm-workspace.yaml`) with an
   `allowBuilds` map in `pnpm-workspace.yaml`. Until it is set, `pnpm install` **exits 1** —
   and because `next dev` runs an install preflight, the dev server refuses to start with a
   stack trace that never names the real cause. The scaffold ships the old
   `pnpm.onlyBuiltDependencies` key in package.json, which pnpm 11 ignores with a warning.
   Fixed by `allowBuilds: {esbuild: true, sharp: true, unrs-resolver: true}`.
   **This will hit the production repo and CI too.**

3. **The blank template costs 9 Postgres tables before any content modelling.** Baseline for
   measuring what the block set adds in Phase 1 — Payload's relational mapping gives every
   block type and array field its own table, and that growth is the thing to watch on Aurora.

4. **Next.js 16 auto-generates `AGENTS.md` and `CLAUDE.md`** on first dev run (disable with
   `agentRules: false` in `next.config.ts`). Harmless, but it appears in the diff unannounced.

5. **No email adapter is configured** — Payload warns and writes email to the console. Fine
   for a POC; a real deployment needs one for admin password resets.

### Deviations from the plan

- **Kept the scaffold's ESLint + Prettier instead of porting `snapmart-frontend`'s Biome.**
  Swapping linters proves nothing about Payload, and the scaffold's ESLint config is tuned
  for Payload/Next generated code. Recorded as a deliberate call, not an oversight; the
  production repo should align on one or the other.

### Open questions raised

- Payload's Postgres schema is created by push-on-boot in dev. Production needs
  `payload migrate` with committed migration files — untested here, and a real operational
  question for an EKS deployment where several pods boot at once (HPA min 1 / max 4).

---

## Phase 1 — Schema definition and content authoring

**Status:** ✅ Done → full write-up in [01-schema.md](01-schema.md)

### Built
4 blocks (`hero`, `richText`, `mediaBlock`, `cta`) registered once at config root; two
unlike collections (`pages`, `product-content`) referencing them by slug; `media` with
imageSizes; `users` with the SoW's six admin roles. No globals.

### Proof
- Both collections' block pickers render the same four blocks from one registration
  (admin UI).
- `about-landers` (hero block) and `prod_01JCOLDBREW1L` (richText block) authored and
  published; anonymous read returns published only.
- Commerce boundary: `POST` carrying `price`/`stock`/`name` → **HTTP 400** with a message
  naming the offending fields. Same request without them → 201.
- `pnpm lint` exit 0 · `pnpm typecheck` exit 0.

### Findings
1. **`blockReferences` shares the config, not the storage.** 9 → 29 tables for 4 blocks ×
   2 collections. Postgres gets one table per block type *per collection*, and drafts
   double it. Projects to ~400–600 tables at the SoW's "21+ content types". Decide per
   collection which blocks it accepts, and whether it needs drafts.
2. `blockReferences` is typed against generated `BlockSlug` keys, so
   `blocks.map(b => b.slug)` (→ `string[]`) does not compile. Slugs must be literals.
3. **Drafts + autosave are cheap and the SoW never mentions them** — recommend in scope.
4. Field named `marketingName`, never `name` — resolves the SoW-vs-glossary contradiction
   in the schema rather than in a comment.
5. Block-level validation surfaces in the panel with the exact field path.

### Scaffold problems (will hit the production repo)
- **The template's ESLint has never run**: missing `@eslint/eslintrc`, and adding it exposes
  a `FlatCompat` × `eslint-config-next@16` circular-structure crash. Replaced with Biome
  ported from `snapmart-frontend`. *This reverses the Phase 0 decision to keep ESLint —
  that call was made before discovering the config was broken.*
- The template's `tests/helpers/seedUser.ts` stops typechecking as soon as `users` gains a
  required field, with a misleading "Property 'draft' is missing" error.

### Open questions raised
- Which blocks should each collection actually accept? (now a database-cost decision)
- Drafts on every collection or only some?
- Migrations: dev pushes on boot; production needs committed `payload migrate` files, and
  EKS boots several pods at once (HPA min 1 / max 4). Untested.

---

## Phase 2 — Reusable content across collection types

**Status:** ✅ Done → full write-up in [02-reusable-content.md](02-reusable-content.md)

### Built
`reusable-content` collection (author once) + a `reusableContent` block placeable in both
`pages` and `product-content`. Two modes: **live link** (default — stores a relationship,
resolves at read) and **copy-on-write** (a `ContentManager` client component replays the
source's blocks into a local copy). Plus `src/seed/` and `POST /api/seed` so every later
phase is reproducible from a clean database.

### Proof
- One source edited → **all three consumers** (1 page + 2 products) show the new copy, and
  **every consumer's `updatedAt` is unchanged** — no write fanned out.
- Unticking the checkbox in the admin panel populated the local copy with exactly the
  source's two blocks in order; a later source edit moved the two live-linked consumers and
  left the diverged one alone.
- `pnpm lint` exit 0 · `pnpm typecheck` exit 0.

### Findings
1. **Nesting blocks does not multiply tables — corrects the Phase 1 projection.** Nested
   block rows live in the same per-collection table, discriminated by a `_path` column
   (`productDetail` vs `productDetail.1.content` in one table). Growth stays
   `block types × collections × 2` at any nesting depth. 29 → 43 tables here, all of it
   explained by one new collection and one new block type.
2. Live-link needs no fan-out write, so there is no drift and no stale window — but a
   consumer's `updatedAt` stops indicating when its rendered content last changed, which
   matters for cache invalidation (Phase 5).
3. Copy-on-write is one-way: re-ticking discards the local copy rather than merging.
4. Custom `ui` fields fail **silently** if `generate:importmap` is not re-run. Belongs in CI.
5. Reusable content deliberately cannot nest inside itself.

### Open questions raised
- No back-reference UI: editing one panel can change 40 live pages with no warning. A
  `join` field would surface "used by" and is worth costing.
- Untested: consumer published while its reusable-content source is still a draft.

---

## Phase 3 — Page templates and layout inheritance

**Status:** ✅ Done → full write-up in [03-templates.md](03-templates.md)

### Built
`page-templates` collection (`name`, `appliesTo`, `strategy`, `layout`) plus a `documentSlot`
marker block saying where a document's own content is spliced in (`main`) and where it may
add its own extras (`extra`). Both strategies implemented in `src/hooks/applyTemplate.ts`:
**copy-on-create** (live on `pages`) and **resolve-at-read** (live on `product-content`).

The seeded *Standard PDP* template is the brief's shape — product's own detail, then
shipping, membership, returns — and its membership section is a **Phase 2 reusable-content
reference**, so both sharing mechanisms compose.

### Proof
- Each product **stores 1 block and renders 4**. Editing the template's returns policy once
  changed both products, and **neither product's `updatedAt` moved**.
- The `extra` slot let one product add a harvest CTA the other does not have, without
  leaving the template.
- Copy-on-create wrote the template's blocks into a new page; a later template edit did
  **not** reach it. Empty slots collapse rather than leaving a gap.
- `pnpm lint` exit 0 · `pnpm typecheck` exit 0.

### Findings
1. **Strategy B's cost is the edit form, not runtime.** The editor's form shows only what
   the document owns — shared sections are absent by design, so editors cannot see the page
   they are producing. **Live Preview should be costed alongside this, not after.**
2. `afterRead` runs per document, so template lookups need a per-request cache (a `WeakMap`
   on the request here). At scale, a shared cache in front is the real answer.
3. The computed field is additive (`resolvedDetail` next to `productDetail`, plus
   `templateApplied`), which keeps the BFF's job simple.
4. `appliesTo` + `filterOptions` stops PDP templates appearing on editorial pages — three
   lines, removes a class of support ticket.
5. Copy-on-create must strip block row ids, or Payload *moves* the template's rows into the
   document instead of copying them.

### Recommendation
**Strategy B for PDPs** (the brief's case) with the `extra` slot as the escape hatch;
**strategy A for campaign/landing pages**. `strategy` is a field on the template, so the
choice is per template rather than hard-coded per collection.

### Open questions raised
- Deleting a template nulls the relationship and silently strips shared sections from every
  document using it. Needs a delete guard or a "used by" count.
- Published document resolving against a *draft* template: untested; decides whether
  template edits can be staged.
- A product's `updatedAt` no longer moves when its rendered content changes — the reason
  Phase 5 looks at cache invalidation.

---

## Phase 4 — GraphQL, REST, and CDN-backed assets

**Status:** ✅ Done → full write-up in [04-apis-and-cdn.md](04-apis-and-cdn.md)

### Built
`@payloadcms/storage-s3` against MinIO with `disablePayloadAccessControl: true` and a
`generateFileURL` that emits `CDN_BASE_URL`; a custom
`GET /api/bff/product-content/:medusaProductId` returning the finished layout keyed by the
id the BFF already holds from Medusa; a dedicated `bff@snapmart.local` service user with an
API key.

### Proof
- GraphQL Playground renders at `/api/graphql-playground` with Docs and Schema panels.
- Media upload → all four objects (original + 3 `imageSizes`) in the bucket, all four
  **HTTP 200 unauthenticated from the CDN host**, `image/png`, correct byte counts.
- BFF endpoint returns `richText → richText → reusableContent → richText → cta` for a
  product storing one block, 404s on an unknown id, and carries no price/stock/name.
- `pnpm lint` exit 0 · `pnpm typecheck` exit 0 · Phase 2 and 3 demos still pass.

### Findings
1. **A hook-computed field is invisible to GraphQL.** `resolvedDetail` worked over REST and
   did not exist in the GraphQL schema at all — so Phase 3's template resolution silently
   did not reach GraphQL consumers. Fixed with `virtual: true`, which adds it to the schema
   and the generated types while creating **zero tables and zero columns**. The same bug
   recurred with `templateApplied` and was caught by the typechecker.
2. **GraphQL will not populate relationships inside a virtual field.** Isolated with a
   control: the same `reusableContent.source { title }` resolves in the stored
   `pages.layout` and returns `null` in the virtual `resolvedDetail`. REST returns it in
   both. **So GraphQL cannot serve template-resolved PDP layouts today** — recommend REST
   plus the custom endpoint for the read path.
3. **`depth` hydration was non-monotonic** — `?depth=0` returned *more* data (3377 B) than
   `?depth=1` (3989 B) — because the hook reused Payload's pre-populated relationship
   rather than choosing its own depth. Fixed; now 2512 → 4854 → 5719 → 5719 B. Generalises:
   any hook composing from a related document must set its depth explicitly.
4. **Drafts do not leak to anonymous callers, but an API key sees them on every request.**
   `?draft=true` anonymously returns published only; the API-key user sees the draft
   whether it asks or not. **The BFF's normal read path should be anonymous**, with the API
   key reserved for preview. Also: `enableAPIKey: true` over REST does not mint a key.
5. Payload's `/api/media/file/*` route **500s instead of 404ing** once
   `disablePayloadAccessControl` is on — matters because the Magento migration carries old
   media URLs.
6. In Payload 3.88 the S3 adapter is a **plugin**; the top-level `storage:` key in current
   docs is v4 and silently does nothing on v3.

### Open questions raised
- Media filenames are not content-hashed, so a same-name re-upload serves a stale edge
  object until invalidated.
- No `Cache-Control` is set on upload; CDN behaviour falls back to bucket defaults.
- The Local API is unavailable to the BFF (separate process), so every read is an HTTP hop
  — the argument for caching template-resolved responses at the BFF.

# Phase 5 — Plugins and third-party integration

Answers: *what plugins can be integrated, and how do third-party services connect to
Payload?*

## How the plugin mechanism works

A Payload plugin is a function `(config) => config`. It takes the built config and returns a
modified one — adding collections, fields, hooks, endpoints or admin components. Everything
in `plugins: []` runs after the incoming config is validated and before it is sanitised.

That has a consequence worth stating: **a plugin can add database tables and columns.**
Installing one is a schema change, not a dependency bump.

## Installed, because the SoW names the need

| Plugin | The need | Schema cost |
|---|---|---|
| `@payloadcms/plugin-seo` | SEO meta is explicitly Payload-owned in the ownership matrix (p.114) | **3 columns**, no tables — `meta_title`, `meta_description`, `meta_image_id` per collection |
| `@payloadcms/plugin-redirects` | Magento → new-platform URL mapping; a replatform that changes every URL without redirects loses its search rankings | **2 tables** — `redirects`, `redirects_rels` |

Total: 57 → 59 tables.

### Proof

`plugin-seo` — fields populate and are readable over both APIs
(`artifacts/05-plugins-and-webhook.txt`):

```
meta.title      : Landers Signature Cold Brew 1L | Landers Superstore
meta.description: Smooth, low-acid cold brew in a resealable 1L bottle.

GraphQL: {"meta":{"title":"Landers Signature Cold Brew 1L | Landers Superstore", …}}
```

`generateTitle` supplies the default from whichever title field the collection has, so
editors get a sensible value without typing one.

`plugin-redirects` — a legacy Magento URL resolving to a new page, by reference rather than
by hard-coded string, so the redirect survives a slug change:

```
created redirect 1 : /about-landers.html -> reference "about-landers"
lookup:              /about-landers.html  ->  /about-landers
```

## Assessed and deliberately NOT installed

The shorter list is the more useful output. Each of these was considered against the SoW,
not against general usefulness.

| Plugin | Verdict |
|---|---|
| `plugin-form-builder` | **Real later need** — Contact Us and Careers (SoW Module 13). Not a POC need: it proves nothing the two installed plugins do not. |
| `plugin-nested-docs` | **Real later need** — page hierarchy and breadcrumbs for the informational pages. Same reasoning. |
| `plugin-sentry` | **Real later need** — observability on an EKS service. Deployment concern, not a modelling one. |
| `plugin-search` | **Careful.** The SoW gives catalogue search to **MeiliSearch/Algolia** (Module 8), indexed from *Medusa* catalogue-change events. Payload's search plugin would index editorial content only. Useful for an in-CMS content search; **must not be mistaken for the product search**, and installing it invites exactly that confusion. |
| `plugin-multi-tenant` | **No.** Single market — landers.ph. Nothing in the SoW suggests multi-tenant or multi-store. |
| `plugin-ecommerce`, `plugin-stripe` | **No — these would violate the ownership matrix.** Medusa owns commerce. Adding product, cart or payment collections to Payload creates a second source of truth for the exact data `snapmart-frontend`'s glossary forbids Payload from holding. |
| `plugin-import-export` | **Probably yes, later.** Genuinely useful for the Magento content migration, but that migration is its own project with its own shape. |

## Third-party integration: the mechanism

"How do we integrate X" has one general answer in Payload: **a hook, optionally packaged as
a plugin.** `src/hooks/notifyCacheInvalidation.ts` is the worked example — an `afterChange`
hook that POSTs an event outward. A Salesforce sync, an analytics event, or a search
reindex would attach at exactly the same point.

It was chosen because it also solves a real problem the earlier phases created.

### The problem it solves

Phases 2 and 3 both deliberately avoid writing to consuming documents — that is what makes
them cheap at catalogue scale. The cost is that **no consumer's `updatedAt` moves when its
rendered content changes**, so a cache keyed on the consumer serves stale content forever.

So the hook does not announce the row that changed. It resolves **who depends on it**:

```
event   : reusable-content.update | changed: reusable-content/3
affected: 4 document(s)
   - reusable-content/3
   - pages/4                    about-landers
   - product-content/8          prod_01JOLIVEOIL500
   - product-content/7          prod_01JCOLDBREW1L

event   : page-templates.update | changed: page-templates/3
affected: 3 document(s)
   - page-templates/3
   - product-content/8          prod_01JOLIVEOIL500
   - product-content/7          prod_01JCOLDBREW1L

event   : product-content.update | changed: product-content/7
affected: 1 document(s)
   - product-content/7          prod_01JCOLDBREW1L
```

An ordinary document announces only itself. A shared one announces its dependents.

### Finding: the dependency is transitive, and the obvious query is wrong

The first implementation queried only direct references and reported **1 affected document
where 3 were stale**. A product can reach a reusable-content document two ways:

```
direct       product.productDetail[] → reusableContent → source
via template product.contentTemplate → template.layout[] → reusableContent → source
```

The second is the *normal* case once templates are in use — the shared membership panel
lives in the PDP template, not on each product. Resolving only the direct path is worse
than doing nothing, because it looks like it worked.

The fix walks `reusable-content → templates → documents` and de-duplicates documents
reachable both ways. **Any dependency-tracking built on this content model has to walk two
levels**, and it will need a third if reusable content is ever allowed to nest.

### Other decisions in the hook worth keeping

- **Only published transitions fire.** Autosave runs every 375 ms; firing on every draft
  save would be a denial-of-service against our own receiver, and a draft changes nothing a
  visitor can see.
- **A failed webhook never fails the editor's save.** It is caught and logged. In production
  this belongs on a retry queue — a dropped invalidation is silent staleness, and a log line
  is not a recovery mechanism.
- **The receiver decides what to purge.** Payload announces; it does not reach into
  CloudFront. That keeps credentials out of the CMS and the policy in one place.

## Findings

1. **Installing a plugin is a schema change.** `plugin-redirects` added two tables and
   `plugin-seo` three columns per collection. On Aurora with migrations, every plugin
   addition is a migration to review — not a `pnpm add`.
2. **`plugin-search` is a naming trap.** It indexes Payload content; the SoW's product
   search is MeiliSearch/Algolia fed from Medusa. Two different things one word apart, in a
   project that already has a documented Medusa-vs-Payload vocabulary problem
   (`snapmart-frontend/docs/glossary.md`).
3. **Turbopack does not reliably hot-reload Payload hook modules.** The transitive fix
   returned stale results through several edit cycles and only took effect after
   `rm -rf .next` and a restart. **Anyone debugging a hook should restart before concluding
   their code is wrong** — this cost time here and will cost it again.

## Open questions raised

- **Webhook delivery is fire-and-forget.** A dropped call means silent staleness. Production
  needs a retry queue or an outbox, and the receiver needs to be idempotent.
- **`limit: 500` on the dependency queries is a guess.** A reusable-content document used by
  more than 500 documents would be silently under-reported. Needs pagination, or a
  collection-wide purge above a threshold.
- **No signature verification is implemented** — the hook sends a shared secret header. A
  real integration should sign the body.

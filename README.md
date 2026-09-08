# snapmart-cms

PayloadCMS **feasibility POC** for the Snapmart Magento 2 → Medusa.js v2 migration.

This is not a CMS build. It is the smallest thing that can honestly answer six questions the
Statement of Work leaves open, with running evidence rather than doc claims.

**→ Read [`docs/feasibility/REPORT.md`](docs/feasibility/REPORT.md) first.** It answers all
six and lists the four decisions required before production.
[`docs/feasibility/PROGRESS.md`](docs/feasibility/PROGRESS.md) is the phase-by-phase log.

| Question | Answer |
|---|---|
| How is schema defined, and content authored per collection type? | [01-schema.md](docs/feasibility/01-schema.md) |
| Reusing the same content across different collection types | [02-reusable-content.md](docs/feasibility/02-reusable-content.md) |
| Page templates / layout inheritance (the PDP case) | [03-templates.md](docs/feasibility/03-templates.md) |
| GraphQL playground, endpoints, and CDN for assets | [04-apis-and-cdn.md](docs/feasibility/04-apis-and-cdn.md) |
| Plugins and third-party integrations | [05-plugins.md](docs/feasibility/05-plugins.md) |

## Running it

```bash
docker compose up -d    # postgres:17 on host 5433, minio + a public-read bucket
cp .env.example .env    # then set PAYLOAD_SECRET
pnpm install
pnpm dev                # http://localhost:3000/admin — create the first user
```

Then seed the fixtures and run the demos:

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/users/login -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"…"}' | jq -r .token)
curl -X POST localhost:3000/api/seed -H "Authorization: JWT $TOKEN"

node scripts/demo-reusable-content.mjs      # one source, three consumers, no writes
node scripts/demo-reusable-divergence.mjs   # copy-on-write divergence
node scripts/demo-page-templates.mjs        # one template, two products, no writes
node scripts/demo-template-override.mjs     # the extra slot, and copy-on-create
```

`docker compose down -v` and repeat reproduces every result from an empty database.

## Layout

| Path | What |
|---|---|
| `src/blocks/` | the four content components, registered once at config root |
| `src/blocks/ReusableContent/` | the shared-content-instance block + its copy-on-write UI field |
| `src/collections/` | `Pages`, `ProductContent`, `ReusableContent`, `PageTemplates`, `Media`, `Users` |
| `src/hooks/applyTemplate.ts` | both layout-inheritance strategies |
| `src/hooks/rejectCommerceFields.ts` | the Medusa/Payload data boundary, enforced |
| `src/hooks/notifyCacheInvalidation.ts` | outward webhook; resolves transitive dependents |
| `src/plugins/` | S3/CDN storage, SEO, redirects |
| `src/endpoints/bff.ts` | `GET /api/bff/product-content/:medusaProductId` |
| `docs/feasibility/artifacts/` | raw captured output behind every claim |

## The one rule this repo enforces in code

From `snapmart-frontend/docs/glossary.md`:

> Never render a price that came from Payload. Payload may hold a Medusa product ID; it must
> not hold the product's name, price, or stock.

A write to `product-content` carrying `price`, `stock` or `name` is rejected with HTTP 400.
The editorial field is `marketingName`; there is no field called `name`.

## Scope

**Not** a content model. The collections and blocks here are the minimum that answers the six
questions. The SoW's "21+ content types" are never enumerated in it, so the real model still
has to be designed. No Medusa, no BFF, no AWS, no IaC, no content migration, no localisation.

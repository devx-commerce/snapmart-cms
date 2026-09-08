# snapmart-cms — POC progress tracker

PayloadCMS feasibility POC for the Snapmart Magento 2 → Medusa.js v2 migration.
Updated at the end of every phase. Nothing is marked **Done** without its command and output.

| Phase | Title | Status | Evidence |
|---|---|---|---|
| 0 | Repo init + Payload booting on Postgres | ✅ Done | `/api/access` → 200 · 9 tables in Postgres · admin user created through the panel |
| 1 | Schema and content authoring | ⬜ Not started | — |
| 2 | Reusable content across collection types | ⬜ Not started | — |
| 3 | Page templates / layout inheritance | ⬜ Not started | — |
| 4 | GraphQL, REST, and CDN-backed assets | ⬜ Not started | — |
| 5 | Plugins, third-party integration, report | ⬜ Not started | — |

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

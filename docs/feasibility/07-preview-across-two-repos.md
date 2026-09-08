# Preview when Payload and the storefront are separate repos

Two questions, answered against a running instance rather than from the docs.

1. Does Live Preview work when the CMS and the storefront are different repos and different
   deployments?
2. Should the BFF always call Payload as an unauthenticated caller?

**Short answers:** yes, and *almost* — the BFF needs exactly one authenticated path.

---

## How Live Preview actually works

It is not what most people assume. It is **not** Payload pushing rendered HTML, and **not**
the storefront reading the saved document.

```
  ┌─────────────── Payload admin (cms.snapmart.ph) ───────────────┐
  │  editor types in the form                                     │
  │            │                                                  │
  │            │ 1. window.postMessage(form data)                 │
  │            ▼                                                  │
  │  ┌──── iframe: the storefront (www.snapmart.ph/preview/…) ──┐ │
  │  │  useLivePreview() receives it                            │ │
  │  │            │                                             │ │
  │  │            │ 2. POSTs that unsaved data BACK to Payload  │ │
  │  │            │    (X-Payload-HTTP-Method-Override: GET)    │ │
  │  │            ▼                                             │ │
  │  │       Payload reads it through the normal pipeline,      │ │
  │  │       afterRead hooks and all, and returns the           │ │
  │  │       fully-resolved document                            │ │
  │  │            │                                             │ │
  │  │            │ 3. storefront re-renders                    │ │
  │  └──────────────────────────────────────────────────────────┘ │
  └───────────────────────────────────────────────────────────────┘
```

Step 2 is the part that matters here. Because the unsaved data goes **back through Payload's
read pipeline**, the `afterRead` hook runs, and the template's shared sections resolve.

### Verified

Simulating exactly what `useLivePreview` sends — unsaved form data, never written to the
database:

```
POST /api/product-content/7
X-Payload-HTTP-Method-Override: GET
{"data":{"marketingName":"UNSAVED EDIT — typed but not saved","contentTemplate":3,
         "productDetail":[{ …a sentence being typed… }]},"depth":2}

→ marketingName  : UNSAVED EDIT — typed but not saved
  templateApplied: {"id":3,"strategy":"resolveAtRead"}
  resolvedDetail : 4 blocks
     1. richText         A sentence the editor is typing right now.
     2. richText         Shipping & Delivery — same-day delivery within M…
     3. reusableContent  -> Landers Membership Benefits
     4. richText         Returns — extended to 60 days for members…
```

The editor's in-progress sentence sits in position 1, with the template's shared sections
resolved around it. **This removes the "editors work blind" objection from Phase 3** — the
one that made Live Preview a budget item rather than a nice-to-have.

---

## The problem: Live Preview wants the storefront to call Payload

`useLivePreview` POSTs to Payload directly, with `credentials: 'include'`. That is a direct
conflict with `snapmart-frontend` ADR 0006:

> This repo holds no Medusa client, no Payload client, and no credentials for either.

### The way out: `requestHandler`

`useLivePreview` accepts a custom `requestHandler`. The population request can be routed
**through the BFF** instead of going to Payload:

```tsx
const { data } = useLivePreview({
  initialData: page,
  serverURL: 'https://cms.snapmart.ph',
  depth: 2,
  requestHandler: ({ data, endpoint }) =>
    fetch(`/bff/preview/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'include',
    }),
})
```

The storefront talks only to the BFF. The BFF forwards to Payload with its own credentials,
merges Medusa data as it does for any other request, and returns **its own response shape** —
so the storefront's components render preview data exactly as they render live data. No
second rendering path, no Payload types in the storefront, ADR 0006 intact.

Without `requestHandler` the storefront would receive Payload's raw shape and need a
client-side mapper duplicating the BFF's merge logic — two implementations of the same join,
which is precisely what ADR 0006 exists to prevent.

---

## Two options, and they are not the same amount of work

### Option A — Live Preview (updates as you type, no save)

| | |
|---|---|
| Editor experience | Best. Side-by-side, live. |
| Payload config | `admin.livePreview.url` returning the storefront preview URL |
| Storefront | new runtime dependency `@payloadcms/live-preview-react` → **needs an ADR** under `snapmart-frontend`'s rules |
| BFF | a `/bff/preview/:endpoint` passthrough |
| Cross-origin | see the checklist below — this is where the time goes |

### Option B — Draft Preview (save, then click "Preview")

| | |
|---|---|
| Editor experience | Good. Sees the real composed page; must save a draft first. |
| Payload config | collection-level `preview: ({ doc }) => …url…` (a plain function returning a URL) |
| Storefront | **no new dependency**, just a route |
| BFF | reads the draft when given a valid preview token |
| Cross-origin | none — a normal link in a new tab |

**Recommendation: build Option B first.** It removes the "working blind" problem for a
fraction of the effort and no new storefront dependency, and it is a prerequisite for A
anyway (both need a preview route and a token). Add A later if editors ask for live typing.

---

## Cross-origin checklist (Option A only)

Everything here is a way Live Preview silently shows a blank iframe.

| # | Thing | Where |
|---|---|---|
| 1 | `cors` must allowlist the storefront origin | Payload config |
| 2 | `csrf` must allowlist the storefront origin | Payload config — cookies are rejected otherwise |
| 3 | The storefront must not send `X-Frame-Options: DENY`, and its CSP `frame-ancestors` must permit the Payload origin | storefront response headers |
| 4 | Both must be HTTPS in any deployed environment | cross-site cookies require `SameSite=None; Secure` |
| 5 | Payload's `serverURL` must be the public URL, not `localhost` | Payload config |

Items 2 and 3 produce the same symptom — an empty iframe with nothing useful in the console —
so check them together.

---

## Question 2: should the BFF always be unauthenticated?

**Almost. It needs two clients, and it should default to the unauthenticated one.**

| Path | Auth | Sees |
|---|---|---|
| every normal page render | **none** | published only |
| the preview route, only | API key | published **+ drafts** |

### Why not just authenticate everything

Measured on this instance with one draft and two published pages:

```
anonymous                  → 2 docs (published)
anonymous + ?draft=true    → 2 docs (published)   ← the flag does not override access control
API key                    → 3 docs (INCLUDING the draft)
API key + ?draft=true      → 3 docs (INCLUDING the draft)
```

An authenticated caller gets drafts **whether or not it asks**. There is no "authenticate but
behave as public" mode. So a BFF that logs in for everything publishes every draft the moment
an editor hits save — and it would pass every test, because in testing there are no drafts.

### The preview path has to be gated

A preview route that trusts a query parameter is an open door:
`www.snapmart.ph/preview/pages/christmas-sale` would show anyone the unpublished page.

The usual shape:

1. Payload's preview URL includes a signed, short-lived token.
2. The storefront route passes the token to the BFF.
3. The BFF validates it, and only then uses its authenticated Payload client.
4. Preview responses are sent `Cache-Control: no-store` so nothing reaches a shared cache.

### What this means for the BFF

```
bff/
  clients/
    payload-public.ts    ← no credentials. Used by every normal request.
    payload-preview.ts   ← API key. Reachable ONLY behind token validation.
```

Two separate clients rather than one client with a flag, so "did this request use the
privileged path?" is answerable by reading the imports rather than by tracing a boolean.

---

## Recommended sequence

1. **BFF preview route + token validation** — needed by both options.
2. **Option B (Draft Preview)** — Payload's `preview` function plus a storefront route. Closes
   the Phase 3 "editors work blind" gap.
3. **Option A (Live Preview)** — only if editors want as-you-type. Needs the ADR for the new
   storefront dependency and the cross-origin checklist above.

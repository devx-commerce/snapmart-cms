# Phase 3 — Page templates and layout inheritance

Answers: *how do we mark a layout as the template for a kind of page, so that on a PDP
everything other than the product's own details and reviews is common across products?*

## Payload has no native page-template feature

There is no "make this page a template" switch. What Payload gives you is hooks, and the
choice of **when** the shared layout is joined to the document. Two answers, and they are
opposites:

| | **A. Copy on create** | **B. Resolve at read** |
|---|---|---|
| When | `beforeValidate`, once, on create | `afterRead`, on every read |
| Document stores the shared blocks | yes | **no** |
| Editor can change a shared section | yes, freely | no — it is not in their form |
| Editing the template later | existing documents **do not** change | **every** document changes at once |
| Storage | duplicated per document | one copy, ever |
| Fits | campaign / landing pages, where each is a one-off | **PDP** — thousands of products, one policy |

Both are implemented (`src/hooks/applyTemplate.ts`) and both are live: `pages` uses A,
`product-content` uses B.

## How it is modelled

A `page-templates` collection holds `name`, `appliesTo` (which collection it is valid for —
so a PDP template cannot be picked on an editorial page), `strategy`, and a `layout`.

The template's layout may contain **`documentSlot`** marker blocks saying where the
document's own content is spliced in. Everything around a marker is the shared part, so
shared sections can sit above *and* below the product's own. Two slots exist:

- `main` — the document's own content field (`productDetail`)
- `extra` — the document's `templateOverrides`, the escape hatch for the one product that
  needs something the shared layout does not provide

A slot with nothing to fill it collapses rather than leaving an empty section.

The seeded *Standard PDP* template is exactly the brief's shape:

```
documentSlot(main)  →  richText "Shipping & Delivery"  →  reusableContent(Membership)
                    →  richText "Returns"              →  documentSlot(extra)
```

Note the third block: **Phase 2's reusable content composes inside Phase 3's template.**
The membership panel is authored once, referenced by the template, and therefore appears on
every product — two levels of sharing, one edit.

## Proof

### Strategy B — one template, two products, no document written

`scripts/demo-page-templates.mjs` (`artifacts/03-template-resolve-at-read.txt`):

```
  prod_01JCOLDBREW1L   (updatedAt …55.630Z)
    stored productDetail : 1 block(s) — the product's own
    resolvedDetail       : 4 block(s) — template + own
      1. richText   "Cold-pressed for 18 hours, then flash-chilled.…"
      2. richText   "Shipping & Delivery — same-day delivery within Metro…"
      3. reusable   -> "Landers Membership Benefits" (live)
      4. richText   "Returns — unopened items can be returned to any Land…"
```

Each product **stores one block** and **renders four**. After editing the template's returns
policy once:

```
>>> edited page-templates/1 ONLY — no write to any product

  prod_01JCOLDBREW1L    4. richText "Returns — extended to 60 days for members during the…"
  prod_01JOLIVEOIL500   4. richText "Returns — extended to 60 days for members during the…"

RESULT: both products changed; product updatedAt unchanged = true
```

At the SoW's catalogue scale this is the whole argument: a policy change is **one row
update**, not a rewrite of every product document.

### The `extra` slot — the escape hatch

`artifacts/03-template-override-and-copy.txt`:

```
  prod_01JCOLDBREW1L    own 1 · extra 0 → richText → richText → reusableContent → richText
  prod_01JOLIVEOIL500   own 1 · extra 1 → richText → richText → reusableContent → richText → cta
```

One product carries a harvest CTA the other does not, without either leaving the template.

### Strategy A — copy on create, for contrast

```
  template "Campaign Landing (starting point)" layout : hero → documentSlot → cta
  new page STORED layout                              : hero → cta
  ^ the template blocks were WRITTEN INTO the page. It owns them now.

  page hero before template edit : "Campaign headline goes here"
  page hero after  template edit : "Campaign headline goes here"

RESULT: copy-on-create page ignored the template edit = true
```

The empty `documentSlot` collapsed, as designed.

## Findings

### 1. Strategy B's real cost is the edit form, not the runtime

Opening `product-content/8` in the admin shows **only what the document owns**:

```
Extra sections           → 01 Call to Action
Product detail sections  → 01 Rich Text
Page template (sidebar)  → Standard PDP
```

Shipping, membership and returns are simply absent from the form. That is correct — the
editor must not be able to change them per product — but it means **an editor cannot see
the page they are producing from the edit screen**. They see a fragment.

**This is the argument for enabling Payload's Live Preview** on `product-content`. It is
not in the SoW and it is not in this POC's scope, but strategy B without it asks editors to
work blind. **Recommend costing Live Preview alongside the template mechanism, not after.**

### 2. `afterRead` is a per-read cost, and needs a per-request cache

Resolving at read means loading the template on every document read. Without care, a
50-product listing is 50 template lookups. `applyTemplate.ts` caches resolved templates in a
`WeakMap` keyed on the Payload request, so a list request loads each distinct template once.

That is sufficient here. **At production scale a shared cache in front of it (the BFF's, or
Redis) is the real answer**, and it is cheap because templates change rarely.

### 3. The computed field is additive, which keeps the BFF's job simple

The hook writes `resolvedDetail` alongside the stored `productDetail` rather than replacing
it. Consumers read `resolvedDetail` and get the finished page; anything needing the raw
authored content still has it. `templateApplied` reports which template resolved and under
which strategy, so the BFF can log or cache-key on it.

### 4. `appliesTo` is worth having from day one

Without it every template appears in every relationship picker and editors pick the wrong
one. `filterOptions` on the relationship field scopes the list to templates declared for
that collection — three lines, and it removes a whole class of support ticket.

### 5. Copy-on-create must strip row ids

Copying template blocks into a document without deleting their `id`s makes Payload try to
*move* the template's own rows into the document rather than create new ones. The hook
strips them. Non-obvious, and it would have shown up as the template mysteriously emptying.

## Recommendation

**Use strategy B (resolve at read) for PDPs**, which is the case the brief asks about. The
shared sections are exactly the kind of content that must change everywhere at once —
shipping terms, returns policy, membership messaging — and the storage and write savings at
catalogue scale are large. Pair it with the `extra` slot so a single product is never a
reason to abandon the template, and budget for Live Preview so editors are not working blind.

**Use strategy A (copy on create) for campaign and landing pages**, where each page is a
one-off and the template is a starting point rather than a policy.

Both should exist. `strategy` is a field on the template, so the choice is made per template
by whoever authors it, not hard-coded per collection.

## Open questions raised

- **What happens when a template is deleted** while documents reference it? Currently the
  relationship nulls (`ON DELETE SET NULL`) and those documents silently lose their shared
  sections. Production needs either a delete guard or a "used by" count before deleting.
- **Template versioning vs. document versioning.** A published product resolving against a
  *draft* template is untested, and the answer decides whether template edits can be staged.
- **Does the storefront cache on the product or the template?** A product's `updatedAt` no
  longer moves when its rendered content changes — deliberate, and the reason Phase 5 looks
  at cache invalidation.

# Phase 2 — Reusable content across collection types

Answers: *how do we author the same content once and use it in entries of different
collection types, instead of retyping the same component everywhere?*

## There are two different problems here, and Payload solves them separately

Conflating them is the mistake worth avoiding, because they fail differently.

| | **Shared block definition** | **Shared content instance** |
|---|---|---|
| What is shared | the *schema* — "a Hero has a heading and an image" | the *content* — "this particular membership panel" |
| Mechanism | `blockReferences` at config root | a `reusable-content` collection + a `reusableContent` block |
| Editing it changes | what editors can build | what visitors see, everywhere at once |
| Solves | "don't redeclare the Hero block in six collections" | "don't retype the membership panel on 40 pages" |

Phase 1 delivered the first. This phase delivers the second.

## What was built

**`reusable-content` collection** — `title` plus a `content` blocks field taking the same
four shared components. This is where an editor authors a panel once.

**`reusableContent` block** — placed in any document's layout, with two modes chosen per
placement by a `useSourceValues` checkbox:

- **checked (default) — live link.** The document stores only the relationship. Rendering
  resolves through to the source. Editing the source changes every consumer at once, with
  no write to any consuming document.
- **unchecked — copy-on-write.** A custom `ui` field (`ContentManager`, a client component)
  fetches the source and replays each of its blocks into the block's own local `content`
  field. From then on the copy belongs to that document and diverges freely.

Both `pages` and `product-content` accept it, which is the point: *different collection
types, one piece of content*.

Ported from `payloadcms/reusable-content-example`, an official Payload repo. One deliberate
change: the upstream `ContentManager` switches on `blockType` and hand-writes the sub-field
state per block, so every new block needs a code change there. This version derives the
sub-field state from the fetched document, so the block library can grow without touching it.

## Proof

### Live link — one source, three consumers, two collection types

`scripts/demo-reusable-content.mjs` (`artifacts/02-reusable-content-live-link.txt`):

```
--- BEFORE ---
  pages/about-landers        updatedAt=…11.849Z  live | Not a member yet?
  product/prod_01JCOLDBREW1L updatedAt=…11.862Z  live | Not a member yet?
  product/prod_01JOLIVEOIL500 updatedAt=…11.881Z live | Not a member yet?

>>> edited reusable-content/1 ONLY (no write to any consuming document)

--- AFTER ---
  pages/about-landers        updatedAt=…11.849Z  live | Members save more — every single trip
  product/prod_01JCOLDBREW1L updatedAt=…11.862Z  live | Members save more — every single trip
  product/prod_01JOLIVEOIL500 updatedAt=…11.881Z live | Members save more — every single trip

RESULT: every consumer reflects the new copy; consumer updatedAt unchanged = true
```

The `updatedAt` timestamps are the load-bearing part. Every consumer shows the new copy and
**not one of them was written to** — there is no fan-out job, no reindex, no stale-document
window. One row changed.

### Copy-on-write — verified in the admin panel

On `product-content/3`, unticking *"Stay in sync with the source"* caused `ContentManager`
to populate the local copy with exactly the source's blocks, in order:

```
productDetail-1-content-row-0  ->  Rich Text
productDetail-1-content-row-1  ->  Call to Action
```

After publishing, a third edit to the source
(`artifacts/02-reusable-content-divergence.txt`):

```
--- AFTER ---
  pages/about-landers          live-linked  "THIRD EDIT — only live-linked consumers move"
  product/prod_01JCOLDBREW1L   local copy   "Members save more — every single trip"
  product/prod_01JOLIVEOIL500  live-linked  "THIRD EDIT — only live-linked consumers move"
```

Two followed. The diverged one kept its own copy.

## Findings

### 1. Nesting blocks does NOT multiply tables — this corrects the Phase 1 projection

The `reusableContent` block contains a nested blocks field, which looked like it should
create another tier of tables. It does not. Payload stores nested block rows in the **same
per-collection table**, discriminated by a `_path` column:

```
$ select _parent_id, _path, _order from product_content_blocks_rich_text;
 _parent_id |          _path          | _order
          3 | productDetail           |      1     <- the product's own block
          3 | productDetail.1.content |      1     <- the local copy inside reusableContent
          4 | productDetail           |      1
```

So the growth formula from Phase 1 stands unchanged at `block types × collections × 2`,
**regardless of nesting depth**. Table count went 29 → 43 here, and every one of those 14 is
explained by the new *collection* and the new *block type*, not by nesting:

- `reusable_content` + `_reusable_content_v` (2)
- `reusable_content_blocks_{hero,rich_text,media_block,cta}` × 2 for versions (8)
- `{pages,product_content}_blocks_reusable_content` × 2 for versions (4)

**The Phase 1 concern is narrower than it first looked.** Deep nesting is free; adding
*collections* and *block types* is what costs.

### 2. Live-link is the default, and it should stay that way

Because a live link stores a relationship rather than a copy, the expensive operations
never happen: no fan-out write, no cache stampede across consuming documents, no drift.
`depth=2` resolves the source in the same query. The only cost is that a consumer's
`updatedAt` no longer tells you when its rendered content last changed — **which matters
for cache invalidation and is addressed in Phase 5.**

### 3. Copy-on-write is one-way, by construction

Once unticked, there is no "re-link and keep my edits" path — re-ticking discards the local
copy and falls back to the source. That is the honest behaviour (the alternative is a merge
UI nobody asked for), but editors need to be told, because the checkbox looks reversible.
**Recommend labelling it in the admin description**, which this build does.

### 4. `ui` fields need `generate:importmap`

A custom admin component is referenced by a path string
(`@/blocks/ReusableContent/ContentManager#ContentManager`) that must be present in
`src/app/(payload)/admin/importMap.js`. Forgetting `pnpm generate:importmap` after adding
one is a silent failure — the field simply does not render. **This belongs in CI**, as a
check that the import map is not stale.

### 5. Deliberate constraint: no recursion

`reusable-content`'s own `content` field takes the four base blocks and **not**
`reusableContent` itself. Reusable content nesting inside reusable content is a cycle
waiting to happen and nothing in the SoW asks for it. Worth keeping unless a real
requirement appears.

## Recommendation

Ship both mechanisms. They answer different halves of the question and the cost is small:

- **`blockReferences`** for every block used in more than one collection — it is free and
  it keeps the config honest.
- **`reusable-content` + the `reusableContent` block, live-linked by default** for content
  that appears verbatim in many places. On the SoW's list, that is at least: membership
  benefit panels, delivery and returns policy copy, tooltips, and validation copy — all
  named as CMS-managed in Module 8, and all of them things that today would be retyped.
- **Keep copy-on-write available but treat it as the exception**, since a copy stops
  receiving corrections to the original.

## Open questions raised

- **Should an editor be able to see what a reusable-content document is used by** before
  editing it? Payload has no built-in back-reference UI here. Editing one panel can change
  40 live pages with no warning. A `join` field would surface it and is worth costing.
- **How is a reusable-content document's own publish state handled** when a consumer is
  published and the source is still draft? Not tested here.

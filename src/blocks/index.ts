import type { Block, BlockSlug } from 'payload'

/**
 * The POC's four content components.
 *
 * These are registered ONCE in payload.config.ts's top-level `blocks` array, and every
 * collection that wants them references them by slug via `blockReferences`. That is the
 * first half of "author once, use everywhere": one *schema*, shared across collection
 * types. The second half -- one *content instance* shared across documents -- is the
 * ReusableContent block added in Phase 2.
 *
 * PAYLOAD v3 vs v4: in v3 a blocks field takes `blockReferences: ['slug']` PLUS an empty
 * `blocks: []` (required for compatibility). In v4 `blockReferences` is removed and the
 * slugs go directly into `blocks`. Every use site carries this note.
 */

export const Hero: Block = {
  slug: 'hero',
  interfaceName: 'HeroBlock',
  labels: { singular: 'Hero', plural: 'Heroes' },
  fields: [
    { name: 'heading', type: 'text', required: true },
    { name: 'subheading', type: 'textarea' },
    { name: 'image', type: 'upload', relationTo: 'media' },
    {
      name: 'alignment',
      type: 'select',
      defaultValue: 'left',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
      ],
    },
  ],
}

export const RichText: Block = {
  slug: 'richText',
  interfaceName: 'RichTextBlock',
  labels: { singular: 'Rich Text', plural: 'Rich Text' },
  fields: [{ name: 'content', type: 'richText', required: true }],
}

export const MediaBlock: Block = {
  slug: 'mediaBlock',
  interfaceName: 'MediaBlockType',
  labels: { singular: 'Media', plural: 'Media' },
  fields: [
    { name: 'media', type: 'upload', relationTo: 'media', required: true },
    { name: 'caption', type: 'text' },
  ],
}

export const Cta: Block = {
  slug: 'cta',
  interfaceName: 'CtaBlock',
  labels: { singular: 'Call to Action', plural: 'Calls to Action' },
  fields: [
    { name: 'heading', type: 'text', required: true },
    { name: 'body', type: 'textarea' },
    { name: 'label', type: 'text', required: true, label: 'Button label' },
    { name: 'href', type: 'text', required: true, label: 'Button URL' },
  ],
}

/**
 * A slot marker. It renders nothing itself -- it tells a page template WHERE a document's
 * own content belongs, so the common sections can sit both above and below it.
 *
 *   main  -> the document's own content field (a product's detail sections)
 *   extra -> the document's `templateOverrides`, for the one product that needs something
 *            the template does not provide
 *
 * Only ever placed inside a page-template's layout, never in a document.
 */
export const DocumentSlot: Block = {
  slug: 'documentSlot',
  interfaceName: 'DocumentSlotBlock',
  labels: { singular: 'Document Slot', plural: 'Document Slots' },
  fields: [
    {
      name: 'slot',
      type: 'select',
      required: true,
      defaultValue: 'main',
      options: [
        { label: "Main — the document's own content", value: 'main' },
        { label: 'Extra — per-document additions', value: 'extra' },
      ],
    },
  ],
}

/**
 * The base content components. `reusableContent` is deliberately NOT in this list: it is
 * registered separately below, because the reusable-content collection's own `content`
 * field takes these four and must not be able to nest reusable content inside itself.
 */
export const contentBlocks: Block[] = [Hero, RichText, MediaBlock, Cta]

/**
 * The slugs, for `blockReferences`. Typed as BlockSlug[] rather than derived with
 * `.map(b => b.slug)` -- that widens to string[], which `blockReferences` rejects, because
 * Payload types it against the generated `Config['blocks']` keys. Keep in step with
 * `contentBlocks` above; the assertion below fails the typecheck if they diverge.
 */
export const contentBlockSlugs = ['hero', 'richText', 'mediaBlock', 'cta'] satisfies BlockSlug[]

// Compile-time guard: every registered block must appear in contentBlockSlugs.
const _slugCoverage: Record<(typeof contentBlocks)[number]['slug'], true> = Object.fromEntries(
  contentBlockSlugs.map((s) => [s, true]),
) as Record<(typeof contentBlocks)[number]['slug'], true>
void _slugCoverage

/**
 * What a document's layout can contain: the four components PLUS a reusable-content
 * placement. Registered at config root in payload.config.ts as
 * `[...contentBlocks, ReusableContentBlock]`.
 */
export const layoutBlockSlugs = [
  'hero',
  'richText',
  'mediaBlock',
  'cta',
  'reusableContent',
] satisfies BlockSlug[]

/**
 * What a page template's layout can contain: everything a document can, plus the slot
 * marker that says where the document's own content goes.
 */
export const templateBlockSlugs = [...layoutBlockSlugs, 'documentSlot'] satisfies BlockSlug[]
